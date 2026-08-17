import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/** Which out-of-stock variants have the most people waiting on them. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const limit = Math.min(Number(req.query.limit ?? 50), 200)

  const { rows } = await knex.raw(
    `
    SELECT
      s.variant_id,
      s.product_id,
      count(*)::int                    AS waiting,
      count(DISTINCT s.email)::int     AS unique_emails,
      count(s.customer_id)::int        AS known_customers,
      min(s.created_at)                AS waiting_since
    FROM restock_subscription s
    WHERE s.deleted_at IS NULL
      AND s.status = ?
    GROUP BY s.variant_id, s.product_id
    ORDER BY count(*) DESC
    LIMIT ?
    `,
    ["active", limit]
  )

  res.json({ variants: rows })
}
