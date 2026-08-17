import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createOrderFulfillmentWorkflow,
  createOrderShipmentWorkflow,
} from "@medusajs/medusa/core-flows"
import type { Rng } from "./random"

/** Share of orders that get fulfilled; the rest stay in the admin's queue. */
const FULFILL_RATE = 0.66

/** Share of fulfillments that then get marked shipped. */
const SHIP_RATE = 0.7

/**
 * Order quantities are BigNumber-backed and can reach the graph as
 * `{ value: "2", precision: 20 }` rather than a plain number.
 *
 * This coercion is load-bearing. `Number(wrapper)` is NaN, and NaN survives all
 * the way into the INSERT, where MikroORM renders it unquoted — Postgres then
 * parses it as an identifier and fails with `column "nan" does not exist`,
 * nowhere near the actual mistake.
 */
function toQuantity(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim() !== "") {
    return Number(value)
  }
  if (value === null || value === undefined) {
    return Number.NaN
  }

  // Three shapes reach this point depending on where the read happened.
  // Fresh out of query.graph in the same process it is a live BigNumber
  // instance; across a process boundary it arrives serialised as
  // `{ value, precision }`; sometimes it is already a plain number. Try each in
  // turn and take the first that yields something finite.
  const candidates = [
    (value as { value?: unknown }).value,
    (value as { numeric?: unknown }).numeric,
    value,
  ]

  for (const candidate of candidates) {
    const asNumber = Number(candidate)
    if (Number.isFinite(asNumber)) {
      return asNumber
    }
  }

  return Number.NaN
}

export async function seedFulfillments(
  container: MedusaContainer,
  rng: Rng,
  orderIds?: string[]
): Promise<{ fulfilled: number; shipped: number }> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    // The inventory_items fields matter: the workflow multiplies the line item
    // quantity by each inventory item's required_quantity to size the
    // fulfillment item, and creates one fulfillment item per reservation.
    fields: [
      "id",
      "items.id",
      "items.quantity",
      // items.quantity is not always resolved — immediately after checkout in
      // the same process the graph returns the item without it. items.detail is
      // the order-item detail row and always carries the quantity, so ask for
      // both and read whichever came back.
      "items.detail.quantity",
      "items.requires_shipping",
      "items.variant.inventory_items.required_quantity",
      "items.variant.inventory_items.inventory.id",
      "fulfillments.id",
      "shipping_methods.shipping_option_id",
    ],
    ...(orderIds?.length ? { filters: { id: orderIds } } : {}),
    pagination: { take: 1000 },
  })

  let fulfilled = 0
  let shipped = 0
  let skipped = 0
  const skipReasons = new Map<string, number>()

  const skip = (reason: string) => {
    skipped++
    skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1)
  }

  for (const order of orders) {
    if (order.fulfillments?.length) {
      continue
    }
    if (!order.shipping_methods?.length) {
      skip("no shipping method")
      continue
    }
    if (!rng.chance(FULFILL_RATE)) {
      continue
    }

    const items = (order.items ?? [])
      .filter((item) => item)
      .map((item) => ({
        id: item!.id,
        quantity: toQuantity(
          item!.quantity ??
            (item as unknown as { detail?: { quantity?: unknown } }).detail
              ?.quantity
        ),
      }))
      .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0)

    if (!items.length) {
      skip(
        order.items?.length
          ? "items had no usable quantity"
          : "order had no items"
      )
      continue
    }

    try {
      const { result: fulfillment } = await createOrderFulfillmentWorkflow(
        container
      ).run({
        input: { order_id: order.id, items },
      })
      fulfilled++

      // Most fulfilled orders then ship. Leaving the rest packed-but-unshipped
      // is what gives the admin a realistic queue at both stages.
      if (rng.chance(SHIP_RATE)) {
        await createOrderShipmentWorkflow(container).run({
          input: {
            order_id: order.id,
            fulfillment_id: fulfillment.id,
            items,
          },
        })
        shipped++
      }
    } catch (error) {
      skip("workflow error")
      const detail =
        error instanceof Error ? error.message : JSON.stringify(error)
      logger.warn(`Fulfillment for order ${order.id} failed: ${detail}`)
    }
  }

  const reasons = [...skipReasons]
    .map(([reason, count]) => `${count} ${reason}`)
    .join(", ")

  logger.info(
    `Fulfillments seeded: ${fulfilled} created, ${shipped} shipped, ${skipped} skipped` +
      (reasons ? ` (${reasons})` : "")
  )

  return { fulfilled, shipped }
}
