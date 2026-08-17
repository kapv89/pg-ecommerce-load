import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { seedOrders } from "./workload-seed/orders"
import { createRng, SEED } from "./workload-seed/random"

/**
 * Places orders against whatever catalogue and customers already exist.
 *
 * Split out from `seed-workload` so order volume can be topped up without
 * rebuilding the catalogue — checkout is the slowest part of the seed and the
 * part most worth re-running on its own.
 */
export default async function seedOrdersScript({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const rng = createRng(SEED + 1)

  const regionService = container.resolve(Modules.REGION)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const customerService = container.resolve(Modules.CUSTOMER)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)

  const [regions, salesChannels, customers, stockLocations] = await Promise.all([
    regionService.listRegions({}),
    salesChannelService.listSalesChannels({ name: "Default Sales Channel" }),
    customerService.listCustomers({}, { take: 1000 }),
    stockLocationService.listStockLocations({}),
  ])

  if (!regions.length || !salesChannels.length || !customers.length || !stockLocations.length) {
    throw new Error("Run `npm run seed` and `npm run seed:workload` first.")
  }

  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id"],
  })

  const { orderIds } = await seedOrders(container, rng, {
    regionId: regions[0].id,
    salesChannelId: salesChannels[0].id,
    customerIds: customers.map((c) => c.id),
    customerEmails: customers.map((c) => c.email!),
    variantIds: variants.map((v) => v.id),
  })

  logger.info(`Placed ${orderIds.length} orders.`)
}
