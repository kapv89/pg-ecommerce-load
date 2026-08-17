import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { REVIEW_MODULE } from "../../../../../modules/review"
import type ReviewModuleService from "../../../../../modules/review/service"
import {
  getActiveSale,
  loadScarcitySignals,
  type ScarcitySignal,
} from "../../sale-merchandising"

/**
 * Product detail page: the product, its top reviews, and — during a sale — the
 * scarcity signals. Same shape as the listing route: one code path, the sale row
 * decides how expensive it is.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const reviews: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "description",
      "thumbnail",
      "variants.id",
      "variants.title",
      "variants.sku",
    ],
    filters: { handle: req.params.handle, status: "published" },
  })

  const product = products[0]

  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found")
  }

  // Indexed on (product_id, status); stays cheap in both workloads.
  const [topReviews, reviewCount] = await reviews.listAndCountProductReviews(
    { product_id: product.id, status: "approved" },
    { take: 5, order: { helpful_count: "DESC" } }
  )

  const sale = await getActiveSale(req)

  let scarcity: Map<string, ScarcitySignal> | null = null
  if (sale?.live_scarcity_enabled) {
    scarcity = await loadScarcitySignals(req, [product.id], sale)
  }

  res.json({
    product,
    reviews: topReviews,
    review_count: reviewCount,
    sale: sale
      ? {
          id: sale.id,
          name: sale.name,
          discount_percentage: sale.discount_percentage,
          ...(scarcity?.get(product.id) ?? {}),
        }
      : null,
  })
}
