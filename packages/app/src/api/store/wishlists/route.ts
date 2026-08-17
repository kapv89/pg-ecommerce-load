import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { randomBytes } from "node:crypto"
import { WISHLIST_MODULE } from "../../../modules/wishlist"
import type WishlistModuleService from "../../../modules/wishlist/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const wishlistService: WishlistModuleService = req.scope.resolve(WISHLIST_MODULE)

  const wishlists = await wishlistService.listWishlists(
    { customer_id: req.auth_context.actor_id },
    { relations: ["items"], order: { created_at: "ASC" } }
  )

  res.json({ wishlists })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const wishlistService: WishlistModuleService = req.scope.resolve(WISHLIST_MODULE)
  const body = req.body as { name?: string; is_public?: boolean }

  const wishlist = await wishlistService.createWishlists({
    customer_id: req.auth_context.actor_id,
    name: body.name ?? "My wishlist",
    is_public: body.is_public ?? false,
    share_token: randomBytes(12).toString("hex"),
  })

  res.status(201).json({ wishlist })
}
