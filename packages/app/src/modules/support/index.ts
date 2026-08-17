import { Module } from "@medusajs/framework/utils"
import SupportModuleService from "./service"

export const SUPPORT_MODULE = "support"

export default Module(SUPPORT_MODULE, {
  service: SupportModuleService,
})
