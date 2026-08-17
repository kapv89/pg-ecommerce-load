import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SALE_MODULE } from "../../../modules/sale"
import type SaleModuleService from "../../../modules/sale/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sale: SaleModuleService = req.scope.resolve(SALE_MODULE)
  const filters: Record<string, unknown> = {}
  if (req.query.status) {
    filters.status = req.query.status
  }
  const [sale_events, count] = await sale.listAndCountSaleEvents(filters, {
    order: { created_at: "DESC" },
    take: 50,
  })
  res.json({ sale_events, count })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sale: SaleModuleService = req.scope.resolve(SALE_MODULE)
  const sale_event = await sale.createSaleEvents(
    req.body as Record<string, unknown>
  )
  res.status(201).json({ sale_event })
}
