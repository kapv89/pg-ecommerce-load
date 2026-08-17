import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BRAND_MODULE } from "../../../modules/brand"
import type BrandModuleService from "../../../modules/brand/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const q = req.query.q as string | undefined
  const filters: Record<string, unknown> = {}

  if (req.query.is_active !== undefined) {
    filters.is_active = req.query.is_active === "true"
  }
  if (q) {
    filters.name = { $ilike: `%${q}%` }
  }

  const [brands, count] = await brandService.listAndCountBrands(filters, {
    take: Math.min(Number(req.query.limit ?? 50), 100),
    skip: Number(req.query.offset ?? 0),
    order: { created_at: "DESC" },
  })

  res.json({ brands, count })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const brand = await brandService.createBrands(req.body as Record<string, unknown>)
  res.status(201).json({ brand })
}
