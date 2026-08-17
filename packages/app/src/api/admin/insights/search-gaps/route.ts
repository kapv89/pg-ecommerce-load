import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Searches that returned nothing, and searches that returned results nobody
 * clicked. Standard merchandising report — and two aggregates over the same
 * high-write table with different predicates, so two distinct query shapes.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const days = Math.min(Number(req.query.days ?? 30), 180)
  const limit = Math.min(Number(req.query.limit ?? 50), 200)

  const noResults = await knex.raw(
    `
    SELECT
      s.normalized_query,
      count(*)::int                     AS searches,
      count(DISTINCT s.session_id)::int AS sessions,
      max(s.searched_at)                AS last_searched_at
    FROM search_query s
    WHERE s.deleted_at IS NULL
      AND s.results_count = 0
      AND s.searched_at >= now() - (? || ' days')::interval
    GROUP BY s.normalized_query
    ORDER BY count(*) DESC
    LIMIT ?
    `,
    [days, limit]
  )

  const noClicks = await knex.raw(
    `
    SELECT
      s.normalized_query,
      count(*)::int                              AS searches,
      round(avg(s.results_count)::numeric, 1)    AS avg_results,
      count(s.clicked_product_id)::int           AS clicks
    FROM search_query s
    WHERE s.deleted_at IS NULL
      AND s.results_count > 0
      AND s.searched_at >= now() - (? || ' days')::interval
    GROUP BY s.normalized_query
    HAVING count(s.clicked_product_id) = 0
    ORDER BY count(*) DESC
    LIMIT ?
    `,
    [days, limit]
  )

  res.json({
    window_days: days,
    zero_results: noResults.rows,
    zero_clicks: noClicks.rows,
  })
}
