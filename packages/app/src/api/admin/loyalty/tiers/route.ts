import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const loyalty: LoyaltyModuleService = req.scope.resolve(LOYALTY_MODULE)
  const tiers = await loyalty.listLoyaltyTiers(
    {},
    { order: { min_lifetime_points: "ASC" } }
  )
  res.json({ tiers })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const loyalty: LoyaltyModuleService = req.scope.resolve(LOYALTY_MODULE)
  const tier = await loyalty.createLoyaltyTiers(req.body as Record<string, unknown>)
  res.status(201).json({ tier })
}
