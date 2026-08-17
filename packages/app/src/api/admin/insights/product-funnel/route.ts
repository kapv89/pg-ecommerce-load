import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Views to saves to reviews for one product, over a window.
 *
 * A deliberately expensive report: three separate scans stitched by a CTE, over
 * the three fastest-growing tables in the schema. If anything in this app is
 * going to show up at the top of a slow query report, it is this.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const days = Math.min(Number(req.query.days ?? 30), 180)
  const limit = Math.min(Number(req.query.limit ?? 20), 50)

  const { rows } = await knex.raw(
    `
    WITH views AS (
      SELECT product_id,
             count(*)::int AS views,
             count(DISTINCT session_id)::int AS sessions
      FROM product_view
      WHERE deleted_at IS NULL
        AND viewed_at >= now() - (? || ' days')::interval
      GROUP BY product_id
    ),
    saves AS (
      SELECT i.product_id, count(*)::int AS saves
      FROM wishlist_item i
      WHERE i.deleted_at IS NULL
        AND i.created_at >= now() - (? || ' days')::interval
      GROUP BY i.product_id
    ),
    reviews AS (
      SELECT product_id,
             count(*)::int AS reviews,
             round(avg(rating)::numeric, 2) AS avg_rating
      FROM product_review
      WHERE deleted_at IS NULL
        AND status = ?
        AND created_at >= now() - (? || ' days')::interval
      GROUP BY product_id
    )
    SELECT
      v.product_id,
      v.views,
      v.sessions,
      coalesce(s.saves, 0)    AS saves,
      coalesce(r.reviews, 0)  AS reviews,
      r.avg_rating,
      round((coalesce(s.saves, 0)::numeric / nullif(v.sessions, 0)) * 100, 2) AS save_rate_pct
    FROM views v
    LEFT JOIN saves s   ON s.product_id = v.product_id
    LEFT JOIN reviews r ON r.product_id = v.product_id
    ORDER BY v.views DESC
    LIMIT ?
    `,
    [days, days, "approved", days, limit]
  )

  res.json({ window_days: days, funnel: rows })
}
