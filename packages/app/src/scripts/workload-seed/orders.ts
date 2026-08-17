import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  createPromotionsWorkflow,
  listShippingOptionsForCartWorkflow,
} from "@medusajs/medusa/core-flows"
import type { Rng } from "./random"
import { CITIES } from "./vocabulary"

export const ORDER_COUNT = 60

export type OrderContext = {
  regionId: string
  salesChannelId: string
  customerIds: string[]
  customerEmails: string[]
  variantIds: string[]
}

/**
 * Places orders through the real checkout path — cart, shipping method, payment
 * collection, payment session, complete — rather than inserting order rows.
 *
 * This is the single richest source of query shapes in the whole seed. Checkout
 * touches cart, line items, pricing, promotions, tax, inventory reservations,
 * payment and fulfillment, and each of those is a separate module, so the reads
 * fan out instead of joining.
 */
export async function seedOrders(
  container: MedusaContainer,
  rng: Rng,
  context: OrderContext,
): Promise<{ orderIds: string[] }> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Promotion codes are unique, so this stage has to tolerate a re-run —
  // `seed:orders` is meant to be repeatable to top up order volume.
  const promotionService = container.resolve(Modules.PROMOTION)
  const existingPromotions = await promotionService.listPromotions({
    code: ["WELCOME10", "FREESHIP"],
  })

  if (existingPromotions.length) {
    logger.info("Promotions already present, skipping.")
  } else {
    logger.info("Seeding promotions...")
    await createPromotionsWorkflow(container).run({
      input: {
        promotionsData: [
          {
            code: "WELCOME10",
            type: "standard",
            status: "active",
            application_method: {
              type: "percentage",
              target_type: "order",
              allocation: "across",
              value: 10,
              currency_code: "eur",
            },
          },
          {
            code: "FREESHIP",
            type: "standard",
            status: "active",
            application_method: {
              type: "fixed",
              target_type: "shipping_methods",
              allocation: "across",
              value: 10,
              currency_code: "eur",
            },
          },
        ],
      },
    })
  }

  // Only variants that are actually purchasable, otherwise checkout fails on the
  // deliberately out-of-stock ones.
  //
  // inventory_quantity is not a readable field on the variant graph entity — it
  // is computed per stock location — so go to the inventory module for the levels
  // and map them back through each variant's inventory item.
  const inventoryService = container.resolve(Modules.INVENTORY)
  const levels = await inventoryService.listInventoryLevels(
    {},
    { take: 100000 },
  )

  const stockByItem = new Map<string, number>()
  for (const level of levels) {
    stockByItem.set(
      level.inventory_item_id,
      (stockByItem.get(level.inventory_item_id) ?? 0) +
        (level.stocked_quantity ?? 0),
    )
  }

  const { data: variantsWithItems } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "manage_inventory",
      "product.status",
      "inventory_items.inventory_item_id",
    ],
    filters: { id: context.variantIds },
  })

  const purchasable = (
    variantsWithItems as unknown as {
      id: string
      manage_inventory: boolean
      product?: { status?: string }
      inventory_items?: { inventory_item_id: string }[]
    }[]
  )
    .filter((variant) => {
      // Part of the catalogue is deliberately left in draft; carts reject those.
      if (variant.product?.status !== "published") {
        return false
      }
      if (!variant.manage_inventory) {
        return true
      }
      const items = variant.inventory_items ?? []
      return (
        items.length > 0 &&
        items.every(
          (item) => (stockByItem.get(item.inventory_item_id) ?? 0) > 5,
        )
      )
    })
    .map((variant) => variant.id)

  if (!purchasable.length) {
    logger.warn("No purchasable variants; skipping order seeding")
    return { orderIds: [] }
  }

  logger.info(`Placing ${ORDER_COUNT} orders through checkout...`)
  const orderIds: string[] = []

  for (let i = 0; i < ORDER_COUNT; i++) {
    const customerIndex = rng.zipf(context.customerIds.length, 0.7)
    const place = rng.pick(CITIES)

    // A few customers order repeatedly and most order once — repeat buyers are
    // what make the customer-history reads on the account page non-trivial.
    const items = rng
      .pickMany(purchasable, rng.int(1, 4))
      .map((variantId) => ({ variant_id: variantId, quantity: rng.int(1, 3) }))

    try {
      const { result: cart } = await createCartWorkflow(container).run({
        input: {
          region_id: context.regionId,
          sales_channel_id: context.salesChannelId,
          customer_id: context.customerIds[customerIndex],
          email: context.customerEmails[customerIndex],
          currency_code: "eur",
          shipping_address: {
            first_name: "Seed",
            last_name: "Customer",
            address_1: `${rng.int(1, 200)} Test Street`,
            city: place.city,
            country_code: place.country,
            postal_code: place.postal,
          },
          items,
        },
      })

      const { result: shippingOptions } =
        await listShippingOptionsForCartWorkflow(container).run({
          input: { cart_id: cart.id },
        })

      if (!shippingOptions.length) {
        logger.warn(`No shipping options for cart ${cart.id}; skipping`)
        continue
      }

      await addShippingMethodToCartWorkflow(container).run({
        input: {
          cart_id: cart.id,
          options: [{ id: shippingOptions[0].id }],
        },
      })

      const { result: paymentCollection } =
        await createPaymentCollectionForCartWorkflow(container).run({
          input: { cart_id: cart.id },
        })

      await createPaymentSessionsWorkflow(container).run({
        input: {
          payment_collection_id: paymentCollection.id,
          provider_id: "pp_system_default",
        },
      })

      const { result: completed } = await completeCartWorkflow(container).run({
        input: { id: cart.id },
      })

      orderIds.push(completed.id)

      // NOT SEEDED: fulfillments.
      //
      // createOrderFulfillmentWorkflow fails inside FulfillmentModuleService
      // with `column "nan" does not exist` for every order, with or without an
      // explicit location_id, and with quantities passed as plain numbers. The
      // orders themselves are unaffected — they are placed, paid and complete —
      // so the gap is limited to the fulfillment, fulfillment_item and shipment
      // tables staying empty, and the admin's shipping queue being empty with
      // them. Worth returning to before the fulfillment path matters to the
      // comparison.
    } catch (error) {
      // Workflow failures arrive as aggregates whose useful text is nested, so
      // unwrap rather than stringifying the wrapper into "[object Object]".
      const detail =
        error instanceof Error
          ? error.message
          : ((error as { errors?: { error?: { message?: string } }[] })?.errors
              ?.map((e) => e?.error?.message)
              .filter(Boolean)
              .join("; ") ?? JSON.stringify(error))

      logger.warn(`Order ${i} failed: ${detail}`)
    }

    if ((i + 1) % 10 === 0) {
      logger.info(`  orders: ${orderIds.length}/${i + 1} placed`)
    }
  }

  logger.info(`Orders seeded: ${orderIds.length}`)

  return { orderIds }
}
