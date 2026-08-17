import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { randomBytes } from "node:crypto"
import { LOYALTY_MODULE } from "../modules/loyalty"
import type LoyaltyModuleService from "../modules/loyalty/service"
import { WISHLIST_MODULE } from "../modules/wishlist"
import type WishlistModuleService from "../modules/wishlist/service"

/** Every new customer gets a loyalty account at the entry tier and a default wishlist. */
export default async function customerCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const loyalty: LoyaltyModuleService = container.resolve(LOYALTY_MODULE)
  const wishlists: WishlistModuleService = container.resolve(WISHLIST_MODULE)

  const existing = await loyalty.listLoyaltyAccounts({ customer_id: data.id })

  if (!existing.length) {
    const [entryTier] = await loyalty.listLoyaltyTiers(
      {},
      { take: 1, order: { min_lifetime_points: "ASC" } }
    )

    await loyalty.createLoyaltyAccounts({
      customer_id: data.id,
      tier_id: entryTier?.id ?? null,
    })
  }

  const existingWishlists = await wishlists.listWishlists({ customer_id: data.id })

  if (!existingWishlists.length) {
    await wishlists.createWishlists({
      customer_id: data.id,
      name: "My wishlist",
      share_token: randomBytes(12).toString("hex"),
    })
  }
}

export const config: SubscriberConfig = {
  event: "customer.created",
}
