import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SUPPORT_MODULE } from "../../../../../modules/support"
import type SupportModuleService from "../../../../../modules/support/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const support: SupportModuleService = req.scope.resolve(SUPPORT_MODULE)

  const [ticket] = await support.listSupportTickets({
    id: req.params.id,
    customer_id: req.auth_context.actor_id,
  })

  if (!ticket) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Ticket not found")
  }

  // Internal agent notes never go to the customer.
  const messages = await support.listTicketMessages(
    { ticket_id: ticket.id, is_internal: false },
    { order: { created_at: "ASC" } }
  )

  res.json({ ticket, messages })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const support: SupportModuleService = req.scope.resolve(SUPPORT_MODULE)
  const body = req.body as { body: string }

  const [ticket] = await support.listSupportTickets({
    id: req.params.id,
    customer_id: req.auth_context.actor_id,
  })

  if (!ticket) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Ticket not found")
  }

  const message = await support.createTicketMessages({
    ticket_id: ticket.id,
    author_type: "customer",
    author_id: req.auth_context.actor_id,
    body: body.body,
  })

  // A customer reply reopens a resolved ticket.
  if (ticket.status === "resolved") {
    await support.updateSupportTickets({ id: ticket.id, status: "open" })
  }

  res.status(201).json({ message })
}
