import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getActiveSale } from "../storefront/sale-merchandising"

/** Banner data for the storefront. Indexed lookup, cheap in both workloads. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sale = await getActiveSale(req)
  res.json({
    sale: sale
      ? {
          id: sale.id,
          name: sale.name,
          discount_percentage: sale.discount_percentage,
          allocation_total: sale.allocation_total,
          allocation_reserved: sale.allocation_reserved,
        }
      : null,
  })
}
