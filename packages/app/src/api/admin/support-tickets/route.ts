import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUPPORT_MODULE } from "../../../modules/support"
import type SupportModuleService from "../../../modules/support/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const support: SupportModuleService = req.scope.resolve(SUPPORT_MODULE)

  const filters: Record<string, unknown> = {}
  if (req.query.status) {
    filters.status = req.query.status
  }
  if (req.query.priority) {
    filters.priority = req.query.priority
  }
  if (req.query.assigned_to) {
    filters.assigned_to = req.query.assigned_to
  }
  if (req.query.unassigned === "true") {
    filters.assigned_to = null
  }
  if (req.query.category) {
    filters.category = req.query.category
  }

  const [tickets, count] = await support.listAndCountSupportTickets(filters, {
    take: Math.min(Number(req.query.limit ?? 50), 100),
    skip: Number(req.query.offset ?? 0),
    order: { created_at: "ASC" },
  })

  res.json({ tickets, count })
}
