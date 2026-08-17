import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"

/**
 * Expires points past their anniversary. Reads a slice of the ledger, writes an
 * offsetting row per account and updates the balance — a nightly batch that
 * touches every active account.
 */
export default async function expireLoyaltyPoints(container: MedusaContainer) {
  const loyalty: LoyaltyModuleService = container.resolve(LOYALTY_MODULE)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const expired = await loyalty.listLoyaltyTransactions(
    {
      type: "earn",
      expires_at: { $lt: new Date() },
    },
    { take: 500, order: { expires_at: "ASC" } }
  )

  if (!expired.length) {
    return
  }

  const byAccount = new Map<string, number>()
  for (const transaction of expired) {
    byAccount.set(
      transaction.account_id,
      (byAccount.get(transaction.account_id) ?? 0) + transaction.points
    )
  }

  for (const [accountId, points] of byAccount) {
    const account = await loyalty.retrieveLoyaltyAccount(accountId)
    const toExpire = Math.min(points, account.points_balance)

    if (toExpire <= 0) {
      continue
    }

    await loyalty.createLoyaltyTransactions({
      account_id: accountId,
      type: "expire",
      points: -toExpire,
      description: "Points expired",
    })

    await loyalty.updateLoyaltyAccounts({
      id: accountId,
      points_balance: account.points_balance - toExpire,
    })
  }

  await loyalty.updateLoyaltyTransactions(
    expired.map((t) => ({ id: t.id, expires_at: null }))
  )

  logger.info(`Expired loyalty points for ${byAccount.size} accounts`)
}

export const config = {
  name: "expire-loyalty-points",
  schedule: "0 3 * * *",
}
