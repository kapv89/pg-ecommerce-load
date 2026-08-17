import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { REVIEW_MODULE } from "../modules/review"
import type ReviewModuleService from "../modules/review/service"

export type CreateReviewInput = {
  product_id: string
  variant_id?: string
  customer_id?: string
  order_id?: string
  author_name: string
  author_email?: string
  title: string
  content: string
  rating: number
}

/**
 * Reviews written against an order the customer actually placed are flagged
 * verified, which is the signal storefronts sort and filter on.
 */
const markVerifiedPurchaseStep = createStep(
  "mark-verified-purchase",
  async (input: CreateReviewInput, { container }) => {
    if (!input.customer_id || !input.order_id) {
      return new StepResponse({ ...input, verified_purchase: false })
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "customer_id", "items.*"],
      filters: {
        id: input.order_id,
        customer_id: input.customer_id,
      },
    })

    const boughtProduct = orders.some((order) =>
      order.items?.some((item) => item?.product_id === input.product_id)
    )

    return new StepResponse({ ...input, verified_purchase: boughtProduct })
  }
)

const createReviewStep = createStep(
  "create-review",
  async (input: CreateReviewInput & { verified_purchase: boolean }, { container }) => {
    const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)

    const review = await reviewService.createProductReviews({
      ...input,
      // Verified reviews skip the moderation queue; everything else waits.
      status: input.verified_purchase ? "approved" : "pending",
      published_at: input.verified_purchase ? new Date() : null,
    })

    return new StepResponse(review, review.id)
  },
  async (reviewId: string | undefined, { container }) => {
    if (!reviewId) {
      return
    }
    const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)
    await reviewService.deleteProductReviews(reviewId)
  }
)

export const createReviewWorkflow = createWorkflow(
  "create-review",
  (input: CreateReviewInput) => {
    const enriched = markVerifiedPurchaseStep(input)
    const review = createReviewStep(enriched)

    // Fans out to the rating rollup subscriber, on a worker rather than inline.
    emitEventStep({
      eventName: "review.created",
      data: transform({ review }, (data) => ({
        id: data.review.id,
        product_id: data.review.product_id,
      })),
    })

    return new WorkflowResponse(review)
  }
)

export default createReviewWorkflow
