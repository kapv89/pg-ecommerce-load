import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

/**
 * Memorystore in cluster mode only has database 0, as does any Redis cluster.
 * Set REDIS_DB_ISOLATION=false there; everything then shares db 0, which works
 * because Medusa namespaces its own keys — it just makes attributing traffic to
 * a subsystem by database index impossible.
 */
const REDIS_DB_ISOLATION = process.env.REDIS_DB_ISOLATION !== 'false'

/**
 * Point a subsystem at its own Redis logical database.
 *
 * The event bus and the workflow engine both drive BullMQ queues, so keeping them
 * apart avoids key collisions. Giving caching and locking their own databases too
 * means `redis-cli -n <db> keys '*'` attributes traffic to one subsystem, which
 * matters when we are trying to explain where load is coming from.
 */
function redisDb(db: number): string {
  const url = new URL(REDIS_URL)
  url.pathname = REDIS_DB_ISOLATION ? `/${db}` : '/0'
  return url.toString()
}

/**
 * Cloud SQL over a public IP with "Allow only SSL connections" presents a
 * server certificate signed by a per-instance CA that the VM does not have in
 * its trust store, so verification has to be relaxed for the connection to
 * establish at all. Over a private IP inside the VPC — the setup these scripts
 * default to — the traffic never leaves the provider's network and DB_SSL stays off.
 */
const databaseDriverOptions: Record<string, unknown> = {
  pool: {
    min: Number(process.env.DB_POOL_MIN ?? 2),
    max: Number(process.env.DB_POOL_MAX ?? 10),
  },
}

if (process.env.DB_SSL === 'true') {
  databaseDriverOptions.connection = { ssl: { rejectUnauthorized: false } }
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: redisDb(0),
    // Set per-process by pm2 (see ecosystem.config.cjs). HTTP instances run as
    // "server" and background instances as "worker"; the default "shared" is
    // only right for a single process. Getting this wrong on a cluster means
    // every HTTP instance also runs the scheduled jobs, so a nightly job fires
    // once per core.
    workerMode: (process.env.MEDUSA_WORKER_MODE ?? "shared") as
      | "shared"
      | "worker"
      | "server",
    // One pool per process, so the cluster's total connection count is
    // instances x this. See the note in the root README before raising it.
    databaseDriverOptions,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  // Medusa defaults every one of these to an in-memory implementation, which is not
  // what a real deployment looks like and changes the query profile we are measuring:
  // in-memory caching hides repeat reads that Redis would absorb, and the in-memory
  // event bus and workflow engine run subscribers inline instead of on background
  // workers. See packages/infra for the Redis service these point at.
  modules: [
    // Custom domain modules. These are the things a real store bolts onto Medusa
    // and each one adds its own tables and query shapes to the workload.
    { resolve: './src/modules/brand' },
    { resolve: './src/modules/review' },
    { resolve: './src/modules/wishlist' },
    { resolve: './src/modules/loyalty' },
    { resolve: './src/modules/restock' },
    { resolve: './src/modules/support' },
    { resolve: './src/modules/analytics' },
    { resolve: './src/modules/sale' },
    {
      resolve: '@medusajs/medusa/caching',
      options: {
        providers: [
          {
            resolve: '@medusajs/caching-redis',
            id: 'caching-redis',
            is_default: true,
            options: {
              redisUrl: redisDb(1),
            },
          },
        ],
      },
    },
    {
      resolve: '@medusajs/medusa/event-bus-redis',
      options: {
        redisUrl: redisDb(2),
      },
    },
    {
      resolve: '@medusajs/medusa/workflow-engine-redis',
      options: {
        redis: {
          redisUrl: redisDb(3),
        },
      },
    },
    {
      resolve: '@medusajs/medusa/locking',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/locking-redis',
            id: 'locking-redis',
            is_default: true,
            options: {
              redisUrl: redisDb(4),
            },
          },
        ],
      },
    },
  ],
})
