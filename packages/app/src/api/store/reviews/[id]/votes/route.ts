import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { REVIEW_MODULE } from "../../../../../modules/review"
import type ReviewModuleService from "../../../../../modules/review/service"

/**
 * "Was this review helpful?" — a read-modify-write on a counter, from a page many
 * people are on at once. The kind of endpoint that produces lock contention on a
 * popular product's top review.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const { vote, session_id } = req.body as {
    vote: "helpful" | "not_helpful"
    session_id: string
  }

  const reviewId = req.params.id
  const customerId = req.auth_context?.actor_id ?? null

  const existing = await reviewService.listReviewVotes({
    review_id: reviewId,
    ...(customerId ? { customer_id: customerId } : { session_id }),
  })

  if (existing.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Already voted on this review"
    )
  }

  const created = await reviewService.createReviewVotes({
    review_id: reviewId,
    customer_id: customerId,
    session_id,
    vote,
  })

  const review = await reviewService.retrieveProductReview(reviewId)

  await reviewService.updateProductReviews({
    id: reviewId,
    helpful_count:
      vote === "helpful" ? review.helpful_count + 1 : review.helpful_count,
    reported_count:
      vote === "not_helpful" ? review.reported_count + 1 : review.reported_count,
  })

  res.status(201).json({ vote: created })
}
