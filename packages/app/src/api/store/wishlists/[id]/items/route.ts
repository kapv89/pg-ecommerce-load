import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { WISHLIST_MODULE } from "../../../../../modules/wishlist"
import type WishlistModuleService from "../../../../../modules/wishlist/service"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const wishlistService: WishlistModuleService = req.scope.resolve(WISHLIST_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const body = req.body as { product_id: string; variant_id?: string; note?: string }

  const [wishlist] = await wishlistService.listWishlists({
    id: req.params.id,
    customer_id: req.auth_context.actor_id,
  })

  if (!wishlist) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Wishlist not found")
  }

  // Snapshot the current price so the storefront can flag price drops later.
  let priceAtAdd: number | null = null
  if (body.variant_id) {
    // The graph's generated types stop at the module boundary, so the price set
    // joined in from the pricing module has to be read off a widened shape.
    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id", "prices.amount", "prices.currency_code"],
      filters: { id: body.variant_id },
    })
    const prices = (variants[0] as { prices?: { amount: number }[] } | undefined)?.prices
    priceAtAdd = prices?.[0]?.amount ?? null
  }

  const item = await wishlistService.createWishlistItems({
    wishlist_id: wishlist.id,
    product_id: body.product_id,
    variant_id: body.variant_id ?? null,
    note: body.note ?? null,
    price_at_add: priceAtAdd,
  })

  res.status(201).json({ item })
}
