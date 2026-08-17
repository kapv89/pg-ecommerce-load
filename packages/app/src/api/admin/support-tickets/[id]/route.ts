import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUPPORT_MODULE } from "../../../../modules/support"
import type SupportModuleService from "../../../../modules/support/service"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const support: SupportModuleService = req.scope.resolve(SUPPORT_MODULE)
  const ticket = await support.retrieveSupportTicket(req.params.id, {
    relations: ["messages"],
  })
  res.json({ ticket })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const support: SupportModuleService = req.scope.resolve(SUPPORT_MODULE)
  const body = req.body as {
    status?: string
    priority?: string
    assigned_to?: string
    reply?: string
    internal_note?: string
  }

  if (body.reply || body.internal_note) {
    await support.createTicketMessages({
      ticket_id: req.params.id,
      author_type: body.internal_note ? "system" : "agent",
      author_id: req.auth_context?.actor_id ?? null,
      body: (body.reply ?? body.internal_note)!,
      is_internal: Boolean(body.internal_note),
    })
  }

  const update: Record<string, unknown> = { id: req.params.id }
  if (body.status) {
    update.status = body.status
    if (body.status === "resolved") {
      update.resolved_at = new Date()
    }
  }
  if (body.priority) {
    update.priority = body.priority
  }
  if (body.assigned_to) {
    update.assigned_to = body.assigned_to
  }
  if (body.reply) {
    update.first_response_at = new Date()
  }

  const ticket = await support.updateSupportTickets(update)

  res.json({ ticket })
}
