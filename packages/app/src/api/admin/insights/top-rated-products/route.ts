import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Merchandising dashboard: best-reviewed products, with a minimum review count so
 * a single five-star review does not top the list.
 *
 * Written as SQL rather than through the module service on purpose. Real admin
 * dashboards do aggregate across a whole table, and an aggregate is a query shape
 * the ORM's CRUD surface never produces.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const minReviews = Number(req.query.min_reviews ?? 3)
  const limit = Math.min(Number(req.query.limit ?? 20), 100)

  const { rows } = await knex.raw(
    `
    SELECT
      r.product_id,
      count(*)::int                                 AS review_count,
      round(avg(r.rating)::numeric, 2)              AS average_rating,
      count(*) FILTER (WHERE r.verified_purchase)::int AS verified_count,
      max(r.created_at)                             AS last_review_at
    FROM product_review r
    WHERE r.status = ?
      AND r.deleted_at IS NULL
    GROUP BY r.product_id
    HAVING count(*) >= ?
    ORDER BY avg(r.rating) DESC, count(*) DESC
    LIMIT ?
    `,
    ["approved", minReviews, limit]
  )

  res.json({ products: rows })
}
