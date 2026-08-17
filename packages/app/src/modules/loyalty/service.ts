import { MedusaService } from "@medusajs/framework/utils"
import { LoyaltyAccount, LoyaltyTier, LoyaltyTransaction } from "./models/loyalty"

class LoyaltyModuleService extends MedusaService({
  LoyaltyTier,
  LoyaltyAccount,
  LoyaltyTransaction,
}) {}

export default LoyaltyModuleService
