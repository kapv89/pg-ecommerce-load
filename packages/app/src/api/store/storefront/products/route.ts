import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  getActiveSale,
  loadScarcitySignals,
  type ScarcitySignal,
} from "../sale-merchandising"

/**
 * The storefront listing page, assembled server-side.
 *
 * Both workloads drive this same route: with no sale running it is a plain
 * indexed read, and with one running it additionally loads the scarcity signals
 * that make the page fall over. Keeping it one code path is the point — the
 * difference between the baseline and the anomaly is a row in the database, not
 * a different endpoint.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const limit = Math.min(Number(req.query.limit ?? 12), 50)
  const offset = Number(req.query.offset ?? 0)
  const categoryId = req.query.category_id as string | undefined

  const filters: Record<string, unknown> = { status: "published" }
  if (categoryId) {
    filters.categories = { id: categoryId }
  }

  const { data: products, metadata } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "thumbnail", "variants.id", "variants.title"],
    filters,
    pagination: { take: limit, skip: offset, order: { created_at: "DESC" } },
  })

  const sale = await getActiveSale(req)

  let scarcity: Map<string, ScarcitySignal> | null = null
  if (sale?.live_scarcity_enabled) {
    scarcity = await loadScarcitySignals(
      req,
      products.map((p) => p.id),
      sale
    )
  }

  res.json({
    products: products.map((product) => ({
      ...product,
      sale: sale
        ? {
            discount_percentage: sale.discount_percentage,
            ...(scarcity?.get(product.id) ?? {}),
          }
        : null,
    })),
    count: metadata?.count ?? products.length,
    sale: sale ? { id: sale.id, name: sale.name } : null,
  })
}
