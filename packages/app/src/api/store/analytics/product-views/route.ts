import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ANALYTICS_MODULE } from "../../../../modules/analytics"
import type AnalyticsModuleService from "../../../../modules/analytics/service"

/**
 * Storefront view beacon. Highest write rate in the app by a wide margin, and the
 * table it fills is the one most likely to go unvacuumed.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const analytics: AnalyticsModuleService = req.scope.resolve(ANALYTICS_MODULE)
  const body = req.body as {
    product_id: string
    variant_id?: string
    session_id: string
    source?: "search" | "category" | "collection" | "direct" | "recommendation" | "email"
    referrer?: string
    country_code?: string
  }

  await analytics.createProductViews({
    ...body,
    customer_id: req.auth_context?.actor_id ?? null,
    viewed_at: new Date(),
  })

  res.sendStatus(204)
}
