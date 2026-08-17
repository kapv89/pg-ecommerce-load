import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEW_MODULE } from "../../../modules/review"
import type ReviewModuleService from "../../../modules/review/service"

/**
 * The moderation queue. Every filter combination the admin UI offers is its own
 * statement, which is why this one route contributes a family of query shapes
 * rather than a single one.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)

  const filters: Record<string, unknown> = {}

  if (req.query.status) {
    filters.status = req.query.status
  }
  if (req.query.product_id) {
    filters.product_id = req.query.product_id
  }
  if (req.query.rating_lte) {
    filters.rating = { $lte: Number(req.query.rating_lte) }
  }
  if (req.query.reported === "true") {
    filters.reported_count = { $gt: 0 }
  }
  if (req.query.q) {
    filters.$or = [
      { title: { $ilike: `%${req.query.q}%` } },
      { content: { $ilike: `%${req.query.q}%` } },
    ]
  }

  const [reviews, count] = await reviewService.listAndCountProductReviews(
    filters,
    {
      take: Math.min(Number(req.query.limit ?? 50), 100),
      skip: Number(req.query.offset ?? 0),
      order: { created_at: "DESC" },
      relations: ["response"],
    }
  )

  res.json({ reviews, count })
}
