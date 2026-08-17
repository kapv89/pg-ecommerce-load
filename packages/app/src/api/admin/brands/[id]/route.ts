import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BRAND_MODULE } from "../../../../modules/brand"
import type BrandModuleService from "../../../../modules/brand/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const brand = await brandService.retrieveBrand(req.params.id)
  res.json({ brand })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const brand = await brandService.updateBrands({
    id: req.params.id,
    ...(req.body as Record<string, unknown>),
  })
  res.json({ brand })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  await brandService.deleteBrands(req.params.id)
  res.json({ id: req.params.id, object: "brand", deleted: true })
}
