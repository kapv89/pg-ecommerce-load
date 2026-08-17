import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SALE_MODULE } from "../../../modules/sale"
import type SaleModuleService from "../../../modules/sale/service"

export type ActiveSale = {
  id: string
  name: string
  discount_percentage: number
  live_scarcity_enabled: boolean
  allocation_tracking_enabled: boolean
  per_customer_limit_enabled: boolean
  allocation_total: number
  allocation_reserved: number
  starts_at: Date | null
}

/**
 * Cheap, indexed lookup on `status`. Runs on every storefront request in both
 * workloads, so it has to stay cheap — the expensive behaviour is everything
 * below, and only when a sale is actually running.
 */
export async function getActiveSale(
  req: MedusaRequest
): Promise<ActiveSale | null> {
  const sale: SaleModuleService = req.scope.resolve(SALE_MODULE)
  const [active] = await sale.listSaleEvents({ status: "active" }, { take: 1 })
  return (active as ActiveSale) ?? null
}

export type ScarcitySignal = {
  product_id: string
  watchers: number
  sold_in_sale: number
}

/**
 * "N people are viewing this" and "only N left at this price".
 *
 * ---------------------------------------------------------------------------
 * THIS IS DELIBERATELY THE NAIVE IMPLEMENTATION. Do not "fix" it.
 * ---------------------------------------------------------------------------
 *
 * It is the shape a team actually ships: someone wrote a helper that answers the
 * question for one product, and the listing page calls it in a loop. Three
 * separate problems, so a triage system has three distinct things to find:
 *
 *   1. N+1. Called once per product tile, so a 12-product listing issues 24
 *      statements instead of 2.
 *   2. Non-sargable predicate. `date_trunc('minute', viewed_at)` wraps the
 *      indexed column in a function, so the (product_id, viewed_at) index cannot
 *      serve the time bound and it degrades to scanning the product's rows —
 *      against the fastest-growing table in the schema.
 *   3. Whole-leaderboard aggregate to answer a single-product question. The
 *      units-sold query groups every order line in the sale window and then the
 *      caller picks one row out of it. Sequential scan of order_item, once per
 *      product, per request — and it gets steadily worse as the sale places more
 *      orders, which is exactly the shape of a real Black Friday incident.
 *
 * At baseline volume with the sale off, none of this runs at all.
 */
export async function loadScarcitySignals(
  req: MedusaRequest,
  productIds: string[],
  sale: ActiveSale
): Promise<Map<string, ScarcitySignal>> {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const signals = new Map<string, ScarcitySignal>()

  const saleStart = sale.starts_at ?? new Date(Date.now() - 6 * 60 * 60 * 1000)

  for (const productId of productIds) {
    const watchers = await knex.raw(
      `
      SELECT count(DISTINCT v.session_id)::int AS watchers
      FROM product_view v
      WHERE v.product_id = ?
        AND v.deleted_at IS NULL
        AND date_trunc('minute', v.viewed_at) > now() - interval '10 minutes'
      `,
      [productId]
    )

    const leaderboard = await knex.raw(
      `
      SELECT oli.product_id, sum(oi.quantity)::int AS sold
      FROM order_item oi
      JOIN order_line_item oli ON oli.id = oi.item_id AND oli.deleted_at IS NULL
      JOIN "order" o ON o.id = oi.order_id AND o.deleted_at IS NULL
      WHERE oi.deleted_at IS NULL
        AND o.created_at >= ?
      GROUP BY oli.product_id
      ORDER BY sold DESC
      `,
      [saleStart]
    )

    const sold = leaderboard.rows.find(
      (row: { product_id: string; sold: number }) => row.product_id === productId
    )

    signals.set(productId, {
      product_id: productId,
      watchers: watchers.rows[0]?.watchers ?? 0,
      sold_in_sale: sold?.sold ?? 0,
    })
  }

  return signals
}
