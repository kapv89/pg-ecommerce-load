import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEW_MODULE } from "../../../../modules/review"
import type ReviewModuleService from "../../../../modules/review/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const review = await reviewService.retrieveProductReview(req.params.id, {
    relations: ["response", "votes"],
  })
  res.json({ review })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const body = req.body as { status: "pending" | "approved" | "rejected" }

  const review = await reviewService.updateProductReviews({
    id: req.params.id,
    status: body.status,
    published_at: body.status === "approved" ? new Date() : null,
  })

  res.json({ review })
}
