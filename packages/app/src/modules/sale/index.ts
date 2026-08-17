import { Module } from "@medusajs/framework/utils"
import SaleModuleService from "./service"

export const SALE_MODULE = "sale"

export default Module(SALE_MODULE, {
  service: SaleModuleService,
})
