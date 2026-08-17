import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SALE_MODULE } from "../modules/sale"
import type SaleModuleService from "../modules/sale/service"

/**
 * Sale bookkeeping hung off the cart write path.
 *
 * ---------------------------------------------------------------------------
 * DELIBERATELY UNOPTIMISED, and only while a sale is active. Do not "fix".
 * ---------------------------------------------------------------------------
 *
 * Two more failure modes, both different from the storefront's N+1:
 *
 *   1. Hot row. Every add-to-cart increments one counter on one sale_event row.
 *      Postgres takes a row lock per update, so under Black Friday concurrency
 *      the writers serialise behind each other and the wait shows up as lock
 *      contention rather than slow SQL — the same statement, fast in isolation,
 *      queueing. This is the one a pure pg_stat_statements view struggles with
 *      and an active-session view catches immediately.
 *
 *   2. Non-sargable predicate. The "one sale order per customer per day" check
 *      wraps the indexed timestamp in date_trunc(), so no index on created_at
 *      can be used and it scans.
 *
 * Runs before the handler and never blocks it: this is merchandising garnish, so
 * a failure here must not cost a customer their cart.
 */
export async function saleCartHooks(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    const saleService: SaleModuleService = req.scope.resolve(SALE_MODULE)
    const [sale] = await saleService.listSaleEvents(
      { status: "active" },
      { take: 1 }
    )

    if (!sale) {
      return next()
    }

    const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const body = (req.body ?? {}) as { quantity?: number; email?: string }
    const quantity = Number(body.quantity ?? 1) || 1

    if (sale.allocation_tracking_enabled) {
      await knex.raw(
        `
        UPDATE sale_event
        SET allocation_reserved = allocation_reserved + ?,
            updated_at = now()
        WHERE id = ?
        `,
        [quantity, sale.id]
      )
    }

    const email = body.email ?? (req as { auth_context?: { actor_id?: string } }).auth_context?.actor_id

    if (sale.per_customer_limit_enabled && email) {
      await knex.raw(
        `
        SELECT count(*)::int AS orders_today
        FROM "order" o
        WHERE o.email = ?
          AND o.deleted_at IS NULL
          AND date_trunc('day', o.created_at) = date_trunc('day', now())
        `,
        [email]
      )
    }
  } catch {
    // Never fail a cart write because the sale garnish had a problem.
  }

  return next()
}
