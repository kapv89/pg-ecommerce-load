import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEW_MODULE } from "../../../../../modules/review"
import type ReviewModuleService from "../../../../../modules/review/service"
import { createReviewWorkflow } from "../../../../../workflows/create-review"

type SortKey = "recent" | "rating_desc" | "rating_asc" | "helpful"

const SORTS: Record<SortKey, Record<string, "ASC" | "DESC">> = {
  recent: { created_at: "DESC" },
  rating_desc: { rating: "DESC" },
  rating_asc: { rating: "ASC" },
  helpful: { helpful_count: "DESC" },
}

/**
 * The product detail page's review pane. The sort and rating filters are separate
 * query shapes, which is the point — a storefront that offers four sort options
 * and a star filter is quietly emitting a dozen different statements.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)

  const productId = req.params.id
  const limit = Math.min(Number(req.query.limit ?? 20), 100)
  const offset = Number(req.query.offset ?? 0)
  const sort = (req.query.sort as SortKey) ?? "recent"
  const rating = req.query.rating ? Number(req.query.rating) : undefined
  const verifiedOnly = req.query.verified_only === "true"

  const filters: Record<string, unknown> = {
    product_id: productId,
    status: "approved",
  }

  if (rating) {
    filters.rating = rating
  }

  if (verifiedOnly) {
    filters.verified_purchase = true
  }

  const [reviews, count] = await reviewService.listAndCountProductReviews(
    filters,
    {
      take: limit,
      skip: offset,
      order: SORTS[sort] ?? SORTS.recent,
      relations: ["response"],
    }
  )

  res.json({ reviews, count, limit, offset })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = req.body as {
    author_name: string
    author_email?: string
    title: string
    content: string
    rating: number
    order_id?: string
    variant_id?: string
  }

  const customerId = req.auth_context?.actor_id

  const { result } = await createReviewWorkflow(req.scope).run({
    input: {
      product_id: req.params.id,
      customer_id: customerId,
      ...body,
    },
  })

  res.status(201).json({ review: result })
}
