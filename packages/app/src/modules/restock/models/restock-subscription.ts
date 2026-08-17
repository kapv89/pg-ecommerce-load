import { model } from "@medusajs/framework/utils"

const RestockSubscription = model
  .define("restock_subscription", {
    id: model.id().primaryKey(),
    variant_id: model.text(),
    product_id: model.text(),
    customer_id: model.text().nullable(),
    email: model.text(),
    status: model
      .enum(["active", "notified", "cancelled"])
      .default("active"),
    notified_at: model.dateTime().nullable(),
    sales_channel_id: model.text().nullable(),
  })
  .indexes([
    { on: ["variant_id"] },
    { on: ["status"] },
    { on: ["variant_id", "status"] },
    { on: ["email"] },
  ])

export default RestockSubscription
