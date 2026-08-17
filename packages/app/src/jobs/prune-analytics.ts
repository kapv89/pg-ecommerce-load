import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Retention on the behaviour tables.
 *
 * A bulk DELETE on the two fastest-growing tables in the schema, run nightly.
 * This is the job that, when it silently stops keeping up, leaves behind the
 * bloat and stale statistics that make everything else look slow.
 */
export default async function pruneAnalytics(container: MedusaContainer) {
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const retentionDays = 90

  const views = await knex.raw(
    `DELETE FROM product_view WHERE viewed_at < now() - (? || ' days')::interval`,
    [retentionDays]
  )

  const searches = await knex.raw(
    `DELETE FROM search_query WHERE searched_at < now() - (? || ' days')::interval`,
    [retentionDays]
  )

  logger.info(
    `Pruned ${views.rowCount ?? 0} product views and ${searches.rowCount ?? 0} searches`
  )
}

export const config = {
  name: "prune-analytics",
  schedule: "0 4 * * *",
}
