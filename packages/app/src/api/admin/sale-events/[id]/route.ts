import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SALE_MODULE } from "../../../../modules/sale"
import type SaleModuleService from "../../../../modules/sale/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sale: SaleModuleService = req.scope.resolve(SALE_MODULE)
  res.json({ sale_event: await sale.retrieveSaleEvent(req.params.id) })
}

/**
 * Flipping `status` to "active" is what turns the anomaly on. Everything else
 * about the deployment stays identical — same build, same routes, same traffic
 * shape — which is the property that makes the two workloads comparable.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sale: SaleModuleService = req.scope.resolve(SALE_MODULE)
  const body = req.body as Record<string, unknown>

  if (body.status === "active") {
    // Only one sale runs at a time; the storefront reads "the active one".
    const running = await sale.listSaleEvents({ status: "active" })
    const others = running.filter((event) => event.id !== req.params.id)
    if (others.length) {
      await sale.updateSaleEvents(
        others.map((event) => ({ id: event.id, status: "ended" as const }))
      )
    }
    if (!body.starts_at) {
      body.starts_at = new Date()
    }
  }

  const sale_event = await sale.updateSaleEvents({ id: req.params.id, ...body })
  res.json({ sale_event })
}
