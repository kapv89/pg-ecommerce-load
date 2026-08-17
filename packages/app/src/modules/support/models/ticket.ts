import { model } from "@medusajs/framework/utils"

export const SupportTicket = model
  .define("support_ticket", {
    id: model.id().primaryKey(),
    customer_id: model.text().nullable(),
    order_id: model.text().nullable(),
    email: model.text(),
    subject: model.text().searchable(),
    category: model
      .enum(["order", "shipping", "return", "product", "billing", "other"])
      .default("other"),
    status: model
      .enum(["open", "pending", "resolved", "closed"])
      .default("open"),
    priority: model.enum(["low", "normal", "high", "urgent"]).default("normal"),
    assigned_to: model.text().nullable(),
    first_response_at: model.dateTime().nullable(),
    resolved_at: model.dateTime().nullable(),
    messages: model.hasMany(() => TicketMessage, { mappedBy: "ticket" }),
  })
  .cascades({
    delete: ["messages"],
  })
  .indexes([
    { on: ["customer_id"] },
    { on: ["order_id"] },
    { on: ["status"] },
    { on: ["assigned_to"] },
    { on: ["status", "priority"] },
  ])

export const TicketMessage = model
  .define("ticket_message", {
    id: model.id().primaryKey(),
    author_type: model.enum(["customer", "agent", "system"]),
    author_id: model.text().nullable(),
    body: model.text().searchable(),
    is_internal: model.boolean().default(false),
    ticket: model.belongsTo(() => SupportTicket, { mappedBy: "messages" }),
  })
  .indexes([{ on: ["author_type"] }])
