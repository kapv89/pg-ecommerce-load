import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SUPPORT_MODULE } from "../modules/support"
import type SupportModuleService from "../modules/support/service"

/** Bumps the priority of anything open past its SLA and still unanswered. */
export default async function escalateStaleTickets(container: MedusaContainer) {
  const support: SupportModuleService = container.resolve(SUPPORT_MODULE)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const stale = await support.listSupportTickets(
    {
      status: ["open", "pending"],
      first_response_at: null,
      created_at: { $lt: cutoff },
      priority: ["low", "normal"],
    },
    { take: 200, order: { created_at: "ASC" } }
  )

  if (!stale.length) {
    return
  }

  await support.updateSupportTickets(
    stale.map((ticket) => ({
      id: ticket.id,
      priority: ticket.priority === "low" ? ("normal" as const) : ("high" as const),
    }))
  )

  for (const ticket of stale) {
    await support.createTicketMessages({
      ticket_id: ticket.id,
      author_type: "system",
      body: "Escalated automatically: no first response within SLA.",
      is_internal: true,
    })
  }

  logger.info(`Escalated ${stale.length} stale support tickets`)
}

export const config = {
  name: "escalate-stale-tickets",
  schedule: "30 * * * *",
}
