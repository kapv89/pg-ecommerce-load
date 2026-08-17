import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { seedCatalog } from "./workload-seed/catalog"
import { seedCustomers } from "./workload-seed/customers"
import { seedEngagement } from "./workload-seed/engagement"
import { seedFulfillments } from "./workload-seed/fulfillments"
import { seedOrders } from "./workload-seed/orders"
import { createRng, SEED } from "./workload-seed/random"

/**
 * Builds the workload dataset on top of the foundation that `npm run seed`
 * creates (store, region, sales channel, stock location, shipping, tax).
 *
 * Run order matters and is not idempotent — run `npm run db:reset` first if you
 * need a clean database. Everything is driven by a fixed PRNG seed so two runs
 * produce the same catalogue, the same skew and the same row counts, which is
 * what makes results comparable between the two triage systems under test.
 */
export default async function seedWorkload({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const rng = createRng(SEED)

  const startedAt = Date.now()
  logger.info(`Seeding workload data (seed=${SEED})...`)

  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const regionService = container.resolve(Modules.REGION)

  const [salesChannels, stockLocations, shippingProfiles, regions] =
    await Promise.all([
      salesChannelService.listSalesChannels({ name: "Default Sales Channel" }),
      stockLocationService.listStockLocations({}),
      fulfillmentService.listShippingProfiles({ type: "default" }),
      regionService.listRegions({}),
    ])

  if (!salesChannels.length || !stockLocations.length || !shippingProfiles.length || !regions.length) {
    throw new Error(
      "Foundation data missing. Run `npm run seed` before `npm run seed:workload`."
    )
  }

  const context = {
    salesChannelId: salesChannels[0].id,
    stockLocationId: stockLocations[0].id,
    shippingProfileId: shippingProfiles[0].id,
    regionId: regions[0].id,
  }

  const catalog = await seedCatalog(container, rng, context)
  const customers = await seedCustomers(container, rng)

  const { orderIds } = await seedOrders(container, rng, {
    regionId: context.regionId,
    salesChannelId: context.salesChannelId,
    customerIds: customers.customerIds,
    customerEmails: customers.customerEmails,
    variantIds: catalog.variantIds,
  })

  await seedFulfillments(container, rng, orderIds)

  await seedEngagement(container, rng, {
    productIds: catalog.productIds,
    variantIds: catalog.variantIds,
    customerIds: customers.customerIds,
    customerEmails: customers.customerEmails,
    orderIds,
  })

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id"],
  })

  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  logger.info(
    `Workload seed complete in ${elapsed}s — ${products.length} products, ` +
      `${customers.customerIds.length} customers, ${orderIds.length} orders.`
  )
}
