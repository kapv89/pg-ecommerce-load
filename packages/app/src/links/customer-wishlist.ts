import CustomerModule from "@medusajs/medusa/customer"
import { defineLink } from "@medusajs/framework/utils"
import WishlistModule from "../modules/wishlist"

export default defineLink(
  CustomerModule.linkable.customer,
  {
    linkable: WishlistModule.linkable.wishlist,
    isList: true,
  }
)
