import { model } from "@medusajs/framework/utils"

const Brand = model
  .define("brand", {
    id: model.id().primaryKey(),
    name: model.text().searchable(),
    handle: model.text(),
    description: model.text().nullable(),
    country_of_origin: model.text().nullable(),
    logo_url: model.text().nullable(),
    is_active: model.boolean().default(true),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["handle"], unique: true },
    { on: ["is_active"] },
  ])

export default Brand
