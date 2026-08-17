import { model } from "@medusajs/framework/utils"

/**
 * Reviews, the merchant's reply, and helpfulness votes.
 *
 * The aggregate lives in one file because the models reference each other and
 * splitting them across files makes the imports circular.
 */

export const ProductReview = model
  .define("product_review", {
    id: model.id().primaryKey(),
    product_id: model.text(),
    variant_id: model.text().nullable(),
    customer_id: model.text().nullable(),
    order_id: model.text().nullable(),
    author_name: model.text(),
    author_email: model.text().nullable(),
    title: model.text().searchable(),
    content: model.text().searchable(),
    rating: model.number(),
    status: model.enum(["pending", "approved", "rejected"]).default("pending"),
    verified_purchase: model.boolean().default(false),
    helpful_count: model.number().default(0),
    reported_count: model.number().default(0),
    published_at: model.dateTime().nullable(),
    response: model.hasOne(() => ReviewResponse, { mappedBy: "review" }).nullable(),
    votes: model.hasMany(() => ReviewVote, { mappedBy: "review" }),
  })
  .cascades({
    delete: ["response", "votes"],
  })
  .indexes([
    { on: ["product_id"] },
    { on: ["customer_id"] },
    { on: ["status"] },
    { on: ["product_id", "status"] },
    { on: ["rating"] },
  ])

export const ReviewResponse = model
  .define("review_response", {
    id: model.id().primaryKey(),
    body: model.text(),
    author_id: model.text().nullable(),
    review: model.belongsTo(() => ProductReview, { mappedBy: "response" }),
  })

export const ReviewVote = model
  .define("review_vote", {
    id: model.id().primaryKey(),
    customer_id: model.text().nullable(),
    session_id: model.text().nullable(),
    vote: model.enum(["helpful", "not_helpful"]),
    review: model.belongsTo(() => ProductReview, { mappedBy: "votes" }),
  })
  .indexes([
    { on: ["customer_id"] },
  ])
