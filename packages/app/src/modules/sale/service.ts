import { MedusaService } from "@medusajs/framework/utils"
import SaleEvent from "./models/sale-event"

class SaleModuleService extends MedusaService({
  SaleEvent,
}) {}

export default SaleModuleService
