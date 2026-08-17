import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ANALYTICS_MODULE } from "../../../../modules/analytics"
import type AnalyticsModuleService from "../../../../modules/analytics/service"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const analytics: AnalyticsModuleService = req.scope.resolve(ANALYTICS_MODULE)
  const body = req.body as {
    query: string
    results_count: number
    session_id: string
    clicked_product_id?: string
    country_code?: string
  }

  await analytics.createSearchQueries({
    ...body,
    normalized_query: body.query.trim().toLowerCase(),
    customer_id: req.auth_context?.actor_id ?? null,
    searched_at: new Date(),
  })

  res.sendStatus(204)
}
