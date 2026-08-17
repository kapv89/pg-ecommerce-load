import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Traffic report over a rolling window against the highest-churn table in the
 * app. This is the query that degrades first when product_view stops being
 * vacuumed, which makes it a useful canary for the triage comparison.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const days = Math.min(Number(req.query.days ?? 7), 90)
  const limit = Math.min(Number(req.query.limit ?? 25), 100)
  const source = req.query.source as string | undefined

  const { rows } = await knex.raw(
    `
    SELECT
      v.product_id,
      count(*)::int                        AS views,
      count(DISTINCT v.session_id)::int    AS sessions,
      count(DISTINCT v.customer_id)::int   AS known_customers,
      max(v.viewed_at)                     AS last_viewed_at
    FROM product_view v
    WHERE v.deleted_at IS NULL
      AND v.viewed_at >= now() - (? || ' days')::interval
      -- Casts are required on both sides: an uncast placeholder in an IS NULL
      -- test is untypable, and source is an enum column so the comparison needs
      -- an explicit text cast. Do not write a question mark in a comment here —
      -- knex counts it as a binding.
      AND (?::text IS NULL OR v.source::text = ?::text)
    GROUP BY v.product_id
    ORDER BY count(*) DESC
    LIMIT ?
    `,
    [days, source ?? null, source ?? null, limit]
  )

  res.json({ window_days: days, products: rows })
}
