import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/** First-response and resolution times, bucketed by category and by agent. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const days = Math.min(Number(req.query.days ?? 30), 365)

  const byCategory = await knex.raw(
    `
    SELECT
      t.category,
      count(*)::int AS tickets,
      count(*) FILTER (WHERE t.status = ?)::int AS open_tickets,
      round(avg(extract(epoch FROM (t.first_response_at - t.created_at)) / 60)::numeric, 1)
        AS avg_first_response_minutes,
      round(avg(extract(epoch FROM (t.resolved_at - t.created_at)) / 3600)::numeric, 1)
        AS avg_resolution_hours
    FROM support_ticket t
    WHERE t.deleted_at IS NULL
      AND t.created_at >= now() - (? || ' days')::interval
    GROUP BY t.category
    ORDER BY count(*) DESC
    `,
    ["open", days]
  )

  const breaching = await knex.raw(
    `
    SELECT
      t.id,
      t.subject,
      t.priority,
      t.status,
      t.created_at,
      round(extract(epoch FROM (now() - t.created_at)) / 3600) AS age_hours
    FROM support_ticket t
    WHERE t.deleted_at IS NULL
      AND t.status IN (?, ?)
      AND t.first_response_at IS NULL
      AND t.created_at < now() - (? || ' hours')::interval
    ORDER BY
      CASE t.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        ELSE 4
      END,
      t.created_at ASC
    LIMIT 100
    `,
    ["open", "pending", Number(req.query.sla_hours ?? 24)]
  )

  res.json({
    window_days: days,
    by_category: byCategory.rows,
    breaching_first_response: breaching.rows,
  })
}
