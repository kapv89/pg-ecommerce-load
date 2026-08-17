import { model } from "@medusajs/framework/utils"

/**
 * Storefront behaviour. These are the highest-write, fastest-growing tables in a
 * real store — they are what turns an otherwise well-behaved database into one
 * with bloat, stale statistics and a vacuum problem, which is exactly the kind of
 * issue the triage systems under comparison are supposed to spot.
 */

export const ProductView = model
  .define("product_view", {
    id: model.id().primaryKey(),
    product_id: model.text(),
    variant_id: model.text().nullable(),
    customer_id: model.text().nullable(),
    session_id: model.text(),
    source: model
      .enum(["search", "category", "collection", "direct", "recommendation", "email"])
      .default("direct"),
    referrer: model.text().nullable(),
    country_code: model.text().nullable(),
    viewed_at: model.dateTime(),
  })
  .indexes([
    { on: ["product_id"] },
    { on: ["session_id"] },
    { on: ["customer_id"] },
    { on: ["viewed_at"] },
    { on: ["product_id", "viewed_at"] },
  ])

export const SearchQuery = model
  .define("search_query", {
    id: model.id().primaryKey(),
    query: model.text().searchable(),
    normalized_query: model.text(),
    results_count: model.number().default(0),
    customer_id: model.text().nullable(),
    session_id: model.text(),
    clicked_product_id: model.text().nullable(),
    country_code: model.text().nullable(),
    searched_at: model.dateTime(),
  })
  .indexes([
    { on: ["normalized_query"] },
    { on: ["results_count"] },
    { on: ["searched_at"] },
    { on: ["session_id"] },
  ])
