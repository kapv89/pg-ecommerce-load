import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Recomputes a product's rating rollup after a review lands.
 *
 * Deliberately a full aggregate over the product's reviews rather than an
 * incremental counter update — it is the naive implementation a real team ships
 * first, and the one that becomes a problem once a product has thousands of
 * reviews.
 */
export default async function reviewCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; product_id: string }>) {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const { rows } = await knex.raw(
    `
    SELECT
      count(*)::int                    AS review_count,
      round(avg(rating)::numeric, 3)   AS average_rating
    FROM product_review
    WHERE product_id = ?
      AND status = ?
      AND deleted_at IS NULL
    `,
    [data.product_id, "approved"]
  )

  logger.debug(
    `Product ${data.product_id} rollup: ${rows[0]?.review_count} reviews, avg ${rows[0]?.average_rating}`
  )
}

export const config: SubscriberConfig = {
  event: "review.created",
}
