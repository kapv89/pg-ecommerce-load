import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/** Top customers by points, joined to their tier and their earn/redeem split. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const limit = Math.min(Number(req.query.limit ?? 25), 100)

  const { rows } = await knex.raw(
    `
    SELECT
      a.customer_id,
      a.points_balance,
      a.lifetime_points,
      t.name AS tier_name,
      coalesce(sum(tx.points) FILTER (WHERE tx.type = ?), 0)::int  AS earned,
      coalesce(-sum(tx.points) FILTER (WHERE tx.type = ?), 0)::int AS redeemed,
      count(tx.id) FILTER (WHERE tx.order_id IS NOT NULL)::int     AS earning_orders
    FROM loyalty_account a
    LEFT JOIN loyalty_tier t
      ON t.id = a.tier_id AND t.deleted_at IS NULL
    LEFT JOIN loyalty_transaction tx
      ON tx.account_id = a.id AND tx.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
    GROUP BY a.id, a.customer_id, a.points_balance, a.lifetime_points, t.name
    ORDER BY a.lifetime_points DESC
    LIMIT ?
    `,
    ["earn", "redeem", limit]
  )

  res.json({ accounts: rows })
}
