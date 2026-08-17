import { MedusaService } from "@medusajs/framework/utils"
import { Wishlist, WishlistItem } from "./models/wishlist"

class WishlistModuleService extends MedusaService({
  Wishlist,
  WishlistItem,
}) {}

export default WishlistModuleService
