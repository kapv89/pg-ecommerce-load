import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { RESTOCK_MODULE } from "../../../modules/restock"
import type RestockModuleService from "../../../modules/restock/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const restock: RestockModuleService = req.scope.resolve(RESTOCK_MODULE)

  const filters: Record<string, unknown> = {}
  if (req.query.status) {
    filters.status = req.query.status
  }
  if (req.query.variant_id) {
    filters.variant_id = req.query.variant_id
  }

  const [subscriptions, count] = await restock.listAndCountRestockSubscriptions(
    filters,
    {
      take: Math.min(Number(req.query.limit ?? 50), 100),
      order: { created_at: "DESC" },
    }
  )

  res.json({ subscriptions, count })
}
