import { model } from "@medusajs/framework/utils"

export const Wishlist = model
  .define("wishlist", {
    id: model.id().primaryKey(),
    customer_id: model.text(),
    name: model.text().default("My wishlist"),
    is_public: model.boolean().default(false),
    share_token: model.text().nullable(),
    items: model.hasMany(() => WishlistItem, { mappedBy: "wishlist" }),
  })
  .cascades({
    delete: ["items"],
  })
  .indexes([
    { on: ["customer_id"] },
    { on: ["share_token"], unique: true },
  ])

export const WishlistItem = model
  .define("wishlist_item", {
    id: model.id().primaryKey(),
    product_id: model.text(),
    variant_id: model.text().nullable(),
    note: model.text().nullable(),
    // Snapshot of the price when the item was added, so the storefront can show
    // "price dropped since you saved this" without a historical price table.
    price_at_add: model.bigNumber().nullable(),
    wishlist: model.belongsTo(() => Wishlist, { mappedBy: "items" }),
  })
  .indexes([
    { on: ["product_id"] },
    { on: ["variant_id"] },
  ])
