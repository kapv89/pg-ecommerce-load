import { authenticate, defineMiddlewares } from "@medusajs/framework/http"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { saleCartHooks } from "./sale-cart-hooks"

/**
 * Stamps every response with the process that served it.
 *
 * Under pm2 cluster mode the instances share one port, so from the outside there
 * is no way to tell whether requests are spreading across cores or piling onto
 * one. This header is what makes that measurable — the load test groups by it.
 */
function stampServingProcess(
  _req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  res.setHeader("x-medusa-pid", String(process.pid))
  if (process.env.NODE_APP_INSTANCE) {
    res.setHeader("x-medusa-instance", process.env.NODE_APP_INSTANCE)
  }
  next()
}

/**
 * Customer-scoped store routes. Everything else under /store stays public: review
 * listings, brand pages, restock signups and the analytics beacons are all things
 * an anonymous visitor does.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/*",
      middlewares: [stampServingProcess],
    },
    {
      // Sale bookkeeping on the cart write path. No-op unless a sale_event row
      // is active — see sale-cart-hooks.ts.
      matcher: "/store/carts*",
      method: ["POST"],
      middlewares: [saleCartHooks],
    },
    {
      matcher: "/store/wishlists*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/loyalty*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/support-tickets*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      // Reviews are readable by anyone but only a signed-in customer can post one.
      matcher: "/store/products/:id/reviews",
      method: "POST",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
  ],
})
