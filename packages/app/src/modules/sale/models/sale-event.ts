import { model } from "@medusajs/framework/utils"

/**
 * A flash sale.
 *
 * The row is a feature switch as much as a record: when one is `active`, the
 * storefront turns on the "live" merchandising behaviours below. Those are the
 * things a real team ships under deadline before a Black Friday, and they are
 * exactly the things that fall over at Black Friday volume. Each flag maps to
 * one specific, separately diagnosable database problem — see
 * src/api/store/storefront and src/api/middlewares.ts.
 */
const SaleEvent = model
  .define("sale_event", {
    id: model.id().primaryKey(),
    name: model.text(),
    status: model.enum(["scheduled", "active", "ended"]).default("scheduled"),
    starts_at: model.dateTime().nullable(),
    ends_at: model.dateTime().nullable(),
    discount_percentage: model.number().default(20),

    // "N people are viewing this" / "only N left" on every product tile.
    live_scarcity_enabled: model.boolean().default(true),
    // A single counter row incremented on every add-to-cart.
    allocation_tracking_enabled: model.boolean().default(true),
    // "one sale order per customer per day".
    per_customer_limit_enabled: model.boolean().default(true),

    allocation_total: model.number().default(250000),
    // The hot row. Every add-to-cart during a sale updates this one field, which
    // is why it serialises writers under load.
    allocation_reserved: model.number().default(0),

    metadata: model.json().nullable(),
  })
  .indexes([{ on: ["status"] }])

export default SaleEvent
