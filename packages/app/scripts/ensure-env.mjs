// Medusa reads .env, which is gitignored. Seed it from the committed template on
// first run so `run:app` works on a fresh clone without a manual copy step.
import { copyFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const envFile = join(packageRoot, ".env")
const template = join(packageRoot, ".env.template")

if (existsSync(envFile)) {
  process.exit(0)
}

copyFileSync(template, envFile)
console.log("Created packages/app/.env from .env.template")
