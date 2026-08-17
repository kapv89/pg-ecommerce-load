import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/** The star histogram on a product's review tab, plus the moderation backlog. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const productId = req.query.product_id as string | undefined

  const distribution = await knex.raw(
    `
    SELECT
      r.rating,
      count(*)::int AS count
    FROM product_review r
    WHERE r.deleted_at IS NULL
      AND r.status = ?
      -- The casts are required. An uncast placeholder in an IS NULL test gives
      -- Postgres nothing to infer the parameter type from and it rejects the
      -- statement at parse time. Note also that knex counts question marks
      -- inside comments as bindings, so do not write one here.
      AND (?::text IS NULL OR r.product_id = ?::text)
    GROUP BY r.rating
    ORDER BY r.rating DESC
    `,
    ["approved", productId ?? null, productId ?? null]
  )

  const backlog = await knex.raw(
    `
    SELECT
      r.status,
      count(*)::int AS count,
      min(r.created_at) AS oldest
    FROM product_review r
    WHERE r.deleted_at IS NULL
    GROUP BY r.status
    `
  )

  res.json({
    distribution: distribution.rows,
    moderation_backlog: backlog.rows,
  })
}
