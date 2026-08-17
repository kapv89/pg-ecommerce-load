import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../../../../modules/brand"
import type BrandModuleService from "../../../../modules/brand/service"

/**
 * Brand landing page: the brand, plus the products linked to it. The products
 * come through the remote query layer because the link lives in its own table.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const [brand] = await brandService.listBrands({
    handle: req.params.handle,
    is_active: true,
  })

  if (!brand) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Brand not found")
  }

  const { data: brandWithProducts } = await query.graph({
    entity: "brand",
    fields: ["id", "name", "products.id", "products.title", "products.handle", "products.thumbnail"],
    filters: { id: brand.id },
  })

  res.json({
    brand,
    products: brandWithProducts[0]?.products ?? [],
  })
}
