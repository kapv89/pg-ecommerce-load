import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Most-saved products, and how many of those saves are now cheaper than when the
 * customer saved them — the trigger for a price-drop campaign.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const limit = Math.min(Number(req.query.limit ?? 25), 100)

  const { rows } = await knex.raw(
    `
    SELECT
      i.product_id,
      count(*)::int                       AS saves,
      count(DISTINCT w.customer_id)::int  AS customers,
      count(*) FILTER (WHERE i.price_at_add IS NOT NULL)::int AS with_price_snapshot,
      round(avg(i.price_at_add)::numeric, 2) AS avg_price_at_add,
      min(i.created_at)                   AS first_saved_at
    FROM wishlist_item i
    JOIN wishlist w
      ON w.id = i.wishlist_id AND w.deleted_at IS NULL
    WHERE i.deleted_at IS NULL
    GROUP BY i.product_id
    ORDER BY count(*) DESC
    LIMIT ?
    `,
    [limit]
  )

  res.json({ products: rows })
}
