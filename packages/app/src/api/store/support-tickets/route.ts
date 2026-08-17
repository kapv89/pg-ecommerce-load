import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUPPORT_MODULE } from "../../../modules/support"
import type SupportModuleService from "../../../modules/support/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const support: SupportModuleService = req.scope.resolve(SUPPORT_MODULE)

  const status = req.query.status as string | undefined
  const filters: Record<string, unknown> = {
    customer_id: req.auth_context.actor_id,
  }
  if (status) {
    filters.status = status
  }

  const [tickets, count] = await support.listAndCountSupportTickets(filters, {
    order: { updated_at: "DESC" },
    take: Math.min(Number(req.query.limit ?? 20), 50),
  })

  res.json({ tickets, count })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const support: SupportModuleService = req.scope.resolve(SUPPORT_MODULE)
  const body = req.body as {
    email: string
    subject: string
    category?: "order" | "shipping" | "return" | "product" | "billing" | "other"
    order_id?: string
    message: string
  }

  const ticket = await support.createSupportTickets({
    customer_id: req.auth_context.actor_id,
    email: body.email,
    subject: body.subject,
    category: body.category ?? "other",
    order_id: body.order_id ?? null,
  })

  await support.createTicketMessages({
    ticket_id: ticket.id,
    author_type: "customer",
    author_id: req.auth_context.actor_id,
    body: body.message,
  })

  res.status(201).json({ ticket })
}
