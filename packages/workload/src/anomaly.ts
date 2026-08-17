import { runWorkload } from "./lib/engine"
import { setSaleActive } from "./lib/sale"
import { anomaly } from "./profiles"

const baseUrl = process.env.MEDUSA_URL ?? "http://localhost:9000"

const sale = await setSaleActive(baseUrl, true)
console.log(`Sale "${sale?.name}" is active — degraded paths are live.`)

try {
  await runWorkload(anomaly, { baseUrl })
} finally {
  // Always end the sale, including on abort or Ctrl-C, so the next baseline run
  // starts from a clean system rather than inheriting the anomaly.
  await setSaleActive(baseUrl, false)
  console.log("\nSale ended — degraded paths are off again.")
}
