import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const loyalty: LoyaltyModuleService = req.scope.resolve(LOYALTY_MODULE)

  const filters: Record<string, unknown> = {}
  if (req.query.customer_id) {
    filters.customer_id = req.query.customer_id
  }
  if (req.query.min_balance) {
    filters.points_balance = { $gte: Number(req.query.min_balance) }
  }
  if (req.query.tier_id) {
    filters.tier_id = req.query.tier_id
  }

  const [accounts, count] = await loyalty.listAndCountLoyaltyAccounts(filters, {
    take: Math.min(Number(req.query.limit ?? 50), 100),
    skip: Number(req.query.offset ?? 0),
    order: { points_balance: "DESC" },
    relations: ["tier"],
  })

  res.json({ accounts, count })
}
