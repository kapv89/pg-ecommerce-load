/**
 * pm2 topology for the Medusa backend.
 *
 * Two roles, because Medusa's default "shared" worker mode is only correct for a
 * single process:
 *
 *   medusa-server  HTTP only (workerMode=server), pm2 cluster mode. Every
 *                  instance shares port 9000 — pm2's master accepts and
 *                  distributes, so N instances means N cores serving requests
 *                  behind one address with no load balancer to run.
 *   medusa-worker  Background only (workerMode=worker), fork mode. Runs the
 *                  scheduled jobs, subscribers and workflow steps off the
 *                  BullMQ queues in Redis. Separate from the servers so a slow
 *                  nightly job cannot eat request-serving capacity.
 *
 * If the servers ran in the default "shared" mode instead, every one of them
 * would also register the cron jobs, and the nightly analytics prune would fire
 * once per core.
 *
 * Sizing: the database and Redis run on the same VM in this setup, so the
 * defaults deliberately leave headroom rather than claiming every core. On a
 * 16-core VM that is 8 servers, 3 workers, 5 cores left for Postgres, Redis and
 * the OS. Override with MEDUSA_SERVER_INSTANCES / MEDUSA_WORKER_INSTANCES when
 * Postgres lives somewhere else, in which case pushing servers towards the core
 * count is reasonable.
 */

const os = require("node:os")
const path = require("node:path")

const CORES = os.cpus().length

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const serverInstances = Number(
  process.env.MEDUSA_SERVER_INSTANCES ?? clamp(Math.floor(CORES * 0.5), 1, 64)
)
const workerInstances = Number(
  process.env.MEDUSA_WORKER_INSTANCES ?? clamp(Math.floor(CORES * 0.2), 1, 16)
)

/**
 * Connection budget.
 *
 * Every process opens its own pool, so the cluster's total is
 * (servers + workers) x pool_max — a number nobody sets deliberately and
 * everybody hits eventually. At 8 servers, 3 workers and Medusa's default pool
 * this idles at 87 of Postgres's default 100 connections, and falls over the
 * moment the instance count grows or a burst opens more.
 *
 * So budget it centrally and divide, rather than setting a per-process pool and
 * hoping. Keep the budget below the server's max_connections with room for
 * psql, the seeders and any monitoring agent. On Cloud SQL, max_connections
 * scales with instance size — check the target tier before raising this.
 *
 * The budget is a ceiling, not a target: pg pools open connections lazily, so a
 * generous pool_max is burst headroom rather than connections held. Dividing by
 * the process count also self-regulates — scale the servers up and each one's
 * pool shrinks to keep the cluster inside the same budget.
 *
 * 700 against max_connections=900 leaves ~200 slots for psql, the seed scripts,
 * a monitoring agent and Postgres's own reserved connections.
 */
const CONNECTION_BUDGET = Number(process.env.DB_CONNECTION_BUDGET ?? 700)

const poolMax = Math.max(
  2,
  Math.floor(CONNECTION_BUDGET / (serverInstances + workerInstances))
)

const appDir = path.join(__dirname, "packages", "app")

// `medusa start` must run from the build output, not the source tree — that is
// where the compiled server and the admin's index.html live. Running it from
// packages/app starts, answers /health, and then 404s every route, which is a
// confusing way to find this out. `run:app` builds and populates this directory
// before pm2 is asked to start anything.
//
// No separate `npm install` here: the directory sits inside the workspace, so
// Node's resolution walks up to the hoisted root node_modules.
const runDir = path.join(appDir, ".medusa", "server")

// Resolve the CLI's JS entry rather than the .bin shim: pm2's cluster mode has
// to hand the file to Node's cluster module, and a shell shim cannot be forked.
const medusaCli = require.resolve("@medusajs/cli/cli.js")

const shared = {
  cwd: runDir,
  script: medusaCli,
  interpreter: "node",
  time: true,
  autorestart: true,
  // A crash loop here almost always means a bad config or an unreachable
  // database; restarting forever just buries the error in the logs.
  max_restarts: 10,
  min_uptime: "20s",
  restart_delay: 2000,
  kill_timeout: 10000,
  merge_logs: true,
}

module.exports = {
  apps: [
    {
      ...shared,
      name: "medusa-server",
      args: "start",
      exec_mode: "cluster",
      instances: serverInstances,
      env: {
        NODE_ENV: "production",
        MEDUSA_WORKER_MODE: "server",
        PORT: process.env.PORT ?? "9000",
        DB_POOL_MAX: String(poolMax),
      },
      out_file: path.join(appDir, "logs", "server-out.log"),
      error_file: path.join(appDir, "logs", "server-error.log"),
    },
    {
      ...shared,
      name: "medusa-worker",
      args: "start",
      // Fork, not cluster: there is no shared listening socket to distribute,
      // each worker just pulls from the BullMQ queues in Redis.
      exec_mode: "fork",
      instances: workerInstances,
      // `medusa start` binds an HTTP port unconditionally — even in worker mode,
      // where the only route registered is /health for liveness probes. So the
      // workers need ports of their own, and one each: without increment_var
      // they all target the same port, the first one wins, and the rest crash
      // with EADDRINUSE. Worse, if a worker binds 9000 before the servers do, it
      // answers /health 200 while 404ing every real route — which looks exactly
      // like a broken build rather than a port collision.
      increment_var: "PORT",
      env: {
        NODE_ENV: "production",
        MEDUSA_WORKER_MODE: "worker",
        PORT: process.env.MEDUSA_WORKER_PORT_BASE ?? "9010",
        DB_POOL_MAX: String(poolMax),
      },
      out_file: path.join(appDir, "logs", "worker-out.log"),
      error_file: path.join(appDir, "logs", "worker-error.log"),
    },
  ],
}
