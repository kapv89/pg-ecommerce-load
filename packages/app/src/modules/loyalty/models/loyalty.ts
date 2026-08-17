import { model } from "@medusajs/framework/utils"

export const LoyaltyTier = model
  .define("loyalty_tier", {
    id: model.id().primaryKey(),
    name: model.text(),
    code: model.text(),
    min_lifetime_points: model.number().default(0),
    discount_percentage: model.number().default(0),
    accounts: model.hasMany(() => LoyaltyAccount, { mappedBy: "tier" }),
  })
  .indexes([{ on: ["code"], unique: true }])

export const LoyaltyAccount = model
  .define("loyalty_account", {
    id: model.id().primaryKey(),
    customer_id: model.text(),
    points_balance: model.number().default(0),
    lifetime_points: model.number().default(0),
    last_earned_at: model.dateTime().nullable(),
    tier: model.belongsTo(() => LoyaltyTier, { mappedBy: "accounts" }).nullable(),
    transactions: model.hasMany(() => LoyaltyTransaction, { mappedBy: "account" }),
  })
  .cascades({
    delete: ["transactions"],
  })
  .indexes([
    { on: ["customer_id"], unique: true },
    { on: ["points_balance"] },
  ])

export const LoyaltyTransaction = model
  .define("loyalty_transaction", {
    id: model.id().primaryKey(),
    type: model.enum(["earn", "redeem", "expire", "adjust"]),
    points: model.number(),
    order_id: model.text().nullable(),
    description: model.text().nullable(),
    expires_at: model.dateTime().nullable(),
    account: model.belongsTo(() => LoyaltyAccount, { mappedBy: "transactions" }),
  })
  .indexes([
    { on: ["type"] },
    { on: ["order_id"] },
    { on: ["expires_at"] },
  ])
