import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BRAND_MODULE } from "../../../modules/brand"
import type BrandModuleService from "../../../modules/brand/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const limit = Math.min(Number(req.query.limit ?? 50), 100)
  const offset = Number(req.query.offset ?? 0)
  const country = req.query.country_of_origin as string | undefined

  const filters: Record<string, unknown> = { is_active: true }
  if (country) {
    filters.country_of_origin = country
  }

  const [brands, count] = await brandService.listAndCountBrands(filters, {
    take: limit,
    skip: offset,
    order: { name: "ASC" },
  })

  res.json({ brands, count, limit, offset })
}
