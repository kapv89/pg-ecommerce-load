import { MedusaService } from "@medusajs/framework/utils"
import { SupportTicket, TicketMessage } from "./models/ticket"

class SupportModuleService extends MedusaService({
  SupportTicket,
  TicketMessage,
}) {}

export default SupportModuleService
