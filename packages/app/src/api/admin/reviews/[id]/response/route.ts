import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEW_MODULE } from "../../../../../modules/review"
import type ReviewModuleService from "../../../../../modules/review/service"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const body = req.body as { body: string }

  const existing = await reviewService.listReviewResponses({
    review_id: req.params.id,
  })

  const response = existing.length
    ? await reviewService.updateReviewResponses({
        id: existing[0].id,
        body: body.body,
      })
    : await reviewService.createReviewResponses({
        review_id: req.params.id,
        body: body.body,
        author_id: req.auth_context?.actor_id ?? null,
      })

  res.status(201).json({ response })
}
