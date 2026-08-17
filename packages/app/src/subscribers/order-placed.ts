import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { awardLoyaltyPointsWorkflow } from "../workflows/award-loyalty-points"

/**
 * Awards loyalty points when an order is placed.
 *
 * With the Redis event bus this runs on a worker, off the checkout request. That
 * matters for the workload: the query load it generates is concurrent with, not
 * serialised behind, the request that triggered it.
 */
export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "customer_id", "total", "currency_code"],
    filters: { id: data.id },
  })

  const order = orders[0]

  if (!order?.customer_id) {
    return
  }

  await awardLoyaltyPointsWorkflow(container).run({
    input: {
      customer_id: order.customer_id,
      order_id: order.id,
      order_total: Number(order.total ?? 0),
      currency_code: order.currency_code,
    },
  })

  logger.info(`Awarded loyalty points for order ${order.id}`)
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
