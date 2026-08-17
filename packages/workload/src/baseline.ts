import { runWorkload } from "./lib/engine"
import { setSaleActive } from "./lib/sale"
import { baseline } from "./profiles"

const baseUrl = process.env.MEDUSA_URL ?? "http://localhost:9000"

// Make sure no sale is left running from a previous anomaly run: a baseline
// with the degraded paths still switched on is not a baseline, and it would
// silently invalidate the comparison.
const ended = await setSaleActive(baseUrl, false)
if (ended) {
  console.log(`Ended leftover sale "${ended.name}" before the baseline run.`)
}

await runWorkload(baseline, { baseUrl })
