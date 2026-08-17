import ProductModule from "@medusajs/medusa/product"
import { defineLink } from "@medusajs/framework/utils"
import BrandModule from "../modules/brand"

/**
 * Many products to one brand.
 *
 * Links are the interesting part of Medusa's module isolation: the association
 * lives in its own table and is resolved by the remote query layer rather than by
 * a SQL join, so a "products with their brand" read is two statements plus a
 * stitch in JS. That fan-out is a large part of why this app produces the query
 * volume it does.
 */
export default defineLink(
  {
    linkable: ProductModule.linkable.product,
    isList: true,
  },
  BrandModule.linkable.brand
)
