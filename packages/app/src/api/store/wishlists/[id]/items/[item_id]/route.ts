import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { WISHLIST_MODULE } from "../../../../../../modules/wishlist"
import type WishlistModuleService from "../../../../../../modules/wishlist/service"

export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const wishlistService: WishlistModuleService = req.scope.resolve(WISHLIST_MODULE)

  const [wishlist] = await wishlistService.listWishlists({
    id: req.params.id,
    customer_id: req.auth_context.actor_id,
  })

  if (!wishlist) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Wishlist not found")
  }

  await wishlistService.deleteWishlistItems(req.params.item_id)

  res.status(200).json({ id: req.params.item_id, object: "wishlist_item", deleted: true })
}
