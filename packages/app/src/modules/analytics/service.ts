import { MedusaService } from "@medusajs/framework/utils"
import { ProductView, SearchQuery } from "./models/analytics"

class AnalyticsModuleService extends MedusaService({
  ProductView,
  SearchQuery,
}) {}

export default AnalyticsModuleService
