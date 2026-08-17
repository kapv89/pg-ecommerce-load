import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { RESTOCK_MODULE } from "../modules/restock"
import type RestockModuleService from "../modules/restock/service"

export type NotifyRestockInput = {
  variant_ids?: string[]
  limit?: number
}

/**
 * Finds subscriptions whose variant is back above zero.
 *
 * Two reads that cannot be a single join — the subscriptions live in a custom
 * module and the stock lives in the inventory module — so this is the module
 * isolation fan-out in its most typical form.
 */
const findNotifiableStep = createStep(
  "find-notifiable-restock-subscriptions",
  async (input: NotifyRestockInput, { container }) => {
    const restock: RestockModuleService = container.resolve(RESTOCK_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const filters: Record<string, unknown> = { status: "active" }
    if (input.variant_ids?.length) {
      filters.variant_id = input.variant_ids
    }

    const subscriptions = await restock.listRestockSubscriptions(filters, {
      take: input.limit ?? 100,
      order: { created_at: "ASC" },
    })

    if (!subscriptions.length) {
      return new StepResponse([])
    }

    const variantIds = [...new Set(subscriptions.map((s) => s.variant_id))]

    const { data: variants } = await query.graph({
      entity: "variant",
      fields: ["id", "inventory_quantity", "manage_inventory"],
      filters: { id: variantIds },
    })

    // inventory_quantity is computed by the inventory module and is not on the
    // variant's generated type, so widen before reading it.
    const stockRows = variants as unknown as {
      id: string
      manage_inventory: boolean
      inventory_quantity?: number
    }[]

    const inStock = new Set(
      stockRows
        .filter((v) => !v.manage_inventory || (v.inventory_quantity ?? 0) > 0)
        .map((v) => v.id)
    )

    return new StepResponse(
      subscriptions.filter((s) => inStock.has(s.variant_id))
    )
  }
)

const sendRestockNotificationsStep = createStep(
  "send-restock-notifications",
  async (
    input: { subscriptions: { id: string; email: string; product_id: string }[] },
    { container }
  ) => {
    if (!input.subscriptions.length) {
      return new StepResponse({ notified: 0 })
    }

    const notification = container.resolve(Modules.NOTIFICATION)
    const restock: RestockModuleService = container.resolve(RESTOCK_MODULE)

    await notification.createNotifications(
      input.subscriptions.map((subscription) => ({
        to: subscription.email,
        channel: "feed",
        template: "restock-available",
        data: {
          product_id: subscription.product_id,
          subscription_id: subscription.id,
        },
      }))
    )

    await restock.updateRestockSubscriptions(
      input.subscriptions.map((subscription) => ({
        id: subscription.id,
        status: "notified" as const,
        notified_at: new Date(),
      }))
    )

    return new StepResponse({ notified: input.subscriptions.length })
  }
)

export const notifyRestockWorkflow = createWorkflow(
  "notify-restock",
  (input: NotifyRestockInput) => {
    const subscriptions = findNotifiableStep(input)

    const result = sendRestockNotificationsStep(
      transform({ subscriptions }, (data) => ({
        subscriptions: data.subscriptions,
      }))
    )

    return new WorkflowResponse(result)
  }
)

export default notifyRestockWorkflow
