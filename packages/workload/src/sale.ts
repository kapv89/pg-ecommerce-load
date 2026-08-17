import { getSaleState, setSaleActive } from "./lib/sale"

const baseUrl = process.env.MEDUSA_URL ?? "http://localhost:9000"
const action = process.argv[2]

if (action === "on") {
  const sale = await setSaleActive(baseUrl, true)
  console.log(`Sale "${sale?.name}" active — degraded paths live.`)
} else if (action === "off") {
  await setSaleActive(baseUrl, false)
  console.log("Sale ended — degraded paths off.")
} else {
  const sale = await getSaleState(baseUrl)
  console.log(sale ? `Active sale: ${sale.name} (${sale.id})` : "No active sale.")
}
