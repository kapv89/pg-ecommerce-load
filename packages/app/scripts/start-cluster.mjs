// Starts the pm2 topology defined in ecosystem.config.cjs and waits until the
// cluster actually serves traffic. Exits once it is up — the processes stay
// running under the pm2 daemon, which is what you want on a VM.
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = join(scriptDir, "..")
const repoRoot = join(appDir, "..", "..")
const ecosystem = join(repoRoot, "ecosystem.config.cjs")
const runDir = join(appDir, ".medusa", "server")
const port = process.env.PORT ?? "9000"
const baseUrl = `http://localhost:${port}`

// `medusa start` runs from the build output, so the build has to exist first.
// Without this check the failure surfaces as every route 404ing while /health
// still answers 200, which is a genuinely confusing thing to debug.
if (!existsSync(join(runDir, "medusa-config.js"))) {
  console.error(
    `No build found at ${runDir}.\nRun \`npm run build\` first (\`npm run run:app\` does this for you).`
  )
  process.exit(1)
}

if (!existsSync(join(runDir, "public", "admin", "index.html"))) {
  console.error(
    `Admin build missing from ${runDir}/public/admin.\nRe-run \`npm run build\`.`
  )
  process.exit(1)
}

// medusa-config.js reads env from its own directory, and `medusa build` wipes
// that directory, so the copy has to happen on every start rather than once.
const sourceEnv = join(appDir, ".env")
if (!existsSync(sourceEnv)) {
  console.error(
    `No .env at ${sourceEnv}. Run \`npm run db:setup\` to create it from the template.`
  )
  process.exit(1)
}
copyFileSync(sourceEnv, join(runDir, ".env"))

const pm2 = (...args) =>
  execFileSync("npx", ["pm2", ...args], { cwd: repoRoot, stdio: "inherit" })

const pm2Json = (...args) =>
  JSON.parse(
    execFileSync("npx", ["pm2", ...args], { cwd: repoRoot, encoding: "utf8" })
  )

// `startOrReload` rather than `start`: re-running run:app on a machine where the
// cluster is already up should roll the processes, not fail with "already
// launched" or silently leave stale code running.
pm2("startOrReload", ecosystem, "--update-env")

const expected = Object.fromEntries(
  createRequire(import.meta.url)(ecosystem).apps.map((app) => [
    app.name,
    app.instances,
  ])
)

const online = (processes, name) =>
  processes.filter((p) => p.name === name && p.pm2_env.status === "online").length

const deadline = Date.now() + 180_000
let ready = false

while (Date.now() < deadline) {
  let serving = false
  try {
    serving = (await fetch(`${baseUrl}/health`)).ok
  } catch {
    // Not listening yet.
  }

  // Waiting on /health alone is not enough: startOrReload rolls the instances
  // one at a time, so the first one to come back answers while the rest are
  // still restarting, and the summary below would under-report the cluster.
  if (serving) {
    const processes = pm2Json("jlist")
    const settled = Object.entries(expected).every(
      ([name, count]) => online(processes, name) >= count
    )
    if (settled) {
      ready = true
      break
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 1000))
}

if (!ready) {
  console.error(
    `\nCluster did not fully come up on ${baseUrl} within 180s.\n` +
      `Check the logs with: npm run logs:app`
  )
  process.exit(1)
}

pm2("status")

const processes = pm2Json("jlist")

console.log(
  `\nCluster is up on ${baseUrl} — ` +
    `${online(processes, "medusa-server")} server instances, ` +
    `${online(processes, "medusa-worker")} workers.\n` +
    `  admin      ${baseUrl}/app\n` +
    `  logs       npm run logs:app\n` +
    `  stop       npm run stop:app\n` +
    `  load test  npm run loadtest\n`
)
