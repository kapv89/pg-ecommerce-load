import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { LOYALTY_MODULE } from "../../../modules/loyalty"
import type LoyaltyModuleService from "../../../modules/loyalty/service"

/** The customer's points page: balance, tier, and recent ledger entries. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const loyalty: LoyaltyModuleService = req.scope.resolve(LOYALTY_MODULE)

  const [account] = await loyalty.listLoyaltyAccounts(
    { customer_id: req.auth_context.actor_id },
    { relations: ["tier"] }
  )

  if (!account) {
    res.json({ account: null, transactions: [], next_tier: null })
    return
  }

  const transactions = await loyalty.listLoyaltyTransactions(
    { account_id: account.id },
    { take: 20, order: { created_at: "DESC" } }
  )

  const [nextTier] = await loyalty.listLoyaltyTiers(
    { min_lifetime_points: { $gt: account.lifetime_points } },
    { take: 1, order: { min_lifetime_points: "ASC" } }
  )

  res.json({ account, transactions, next_tier: nextTier ?? null })
}
