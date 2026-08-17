import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { randomBytes } from "node:crypto"
import { ANALYTICS_MODULE } from "../../modules/analytics"
import type AnalyticsModuleService from "../../modules/analytics/service"
import { RESTOCK_MODULE } from "../../modules/restock"
import type RestockModuleService from "../../modules/restock/service"
import { REVIEW_MODULE } from "../../modules/review"
import type ReviewModuleService from "../../modules/review/service"
import { SUPPORT_MODULE } from "../../modules/support"
import type SupportModuleService from "../../modules/support/service"
import { WISHLIST_MODULE } from "../../modules/wishlist"
import type WishlistModuleService from "../../modules/wishlist/service"
import type { Rng } from "./random"
import {
  FIRST_NAMES,
  LAST_NAMES,
  MISSING_SEARCH_TERMS,
  REVIEW_BODIES,
  REVIEW_TITLES,
  SEARCH_TERMS,
  TICKET_BODIES,
  TICKET_SUBJECTS,
} from "./vocabulary"

export const REVIEW_COUNT = 900
export const WISHLIST_COUNT = 90
export const RESTOCK_COUNT = 220
export const TICKET_COUNT = 160
export const PRODUCT_VIEW_COUNT = 9000
export const SEARCH_COUNT = 2400

const INSERT_CHUNK = 500

async function inChunks<T>(items: T[], fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += INSERT_CHUNK) {
    await fn(items.slice(i, i + INSERT_CHUNK))
  }
}

export type EngagementContext = {
  productIds: string[]
  variantIds: string[]
  customerIds: string[]
  customerEmails: string[]
  orderIds: string[]
}

export async function seedEngagement(
  container: MedusaContainer,
  rng: Rng,
  context: EngagementContext
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const reviews: ReviewModuleService = container.resolve(REVIEW_MODULE)
  const wishlists: WishlistModuleService = container.resolve(WISHLIST_MODULE)
  const restock: RestockModuleService = container.resolve(RESTOCK_MODULE)
  const support: SupportModuleService = container.resolve(SUPPORT_MODULE)
  const analytics: AnalyticsModuleService = container.resolve(ANALYTICS_MODULE)

  logger.info(`Seeding ${REVIEW_COUNT} reviews...`)
  const reviewRows = Array.from({ length: REVIEW_COUNT }, () => {
    // Reviews concentrate on popular products, so a handful of products have
    // hundreds and the long tail has none. That skew is what makes the rating
    // rollup query behave differently per product.
    const productId = context.productIds[rng.zipf(context.productIds.length, 1.2)]
    const hasCustomer = rng.chance(0.75)
    const customerIndex = rng.int(0, context.customerIds.length - 1)
    const status = rng.weighted(
      ["approved", "pending", "rejected"] as const,
      [82, 13, 5]
    )

    return {
      product_id: productId,
      customer_id: hasCustomer ? context.customerIds[customerIndex] : null,
      order_id:
        hasCustomer && context.orderIds.length && rng.chance(0.4)
          ? rng.pick(context.orderIds)
          : null,
      author_name: hasCustomer
        ? `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)[0]}.`
        : "Anonymous",
      author_email: hasCustomer ? context.customerEmails[customerIndex] : null,
      title: rng.pick(REVIEW_TITLES),
      content: rng.pick(REVIEW_BODIES),
      // Ratings are J-shaped: mostly 5s, a bump of 1s, few in the middle.
      rating: rng.weighted([5, 4, 3, 2, 1], [45, 24, 11, 7, 13]),
      status,
      verified_purchase: hasCustomer && rng.chance(0.55),
      helpful_count: rng.chance(0.4) ? rng.int(1, 60) : 0,
      reported_count: rng.chance(0.06) ? rng.int(1, 4) : 0,
      published_at: status === "approved" ? rng.dateWithin(400) : null,
    }
  })

  await inChunks(reviewRows, (chunk) => reviews.createProductReviews(chunk))

  logger.info("Seeding merchant responses and review votes...")
  const createdReviews = await reviews.listProductReviews(
    { status: "approved" },
    { take: 400, order: { created_at: "DESC" } }
  )

  const responses = createdReviews
    .filter(() => rng.chance(0.18))
    .map((review) => ({
      review_id: review.id,
      body: "Thanks for the feedback — we have passed this on to the team.",
      author_id: null,
    }))

  if (responses.length) {
    await inChunks(responses, (chunk) => reviews.createReviewResponses(chunk))
  }

  const votes = createdReviews.flatMap((review) =>
    Array.from({ length: rng.chance(0.5) ? rng.int(1, 8) : 0 }, () => ({
      review_id: review.id,
      customer_id: rng.chance(0.6) ? rng.pick(context.customerIds) : null,
      session_id: randomBytes(8).toString("hex"),
      vote: rng.weighted(["helpful", "not_helpful"] as const, [80, 20]),
    }))
  )

  if (votes.length) {
    await inChunks(votes, (chunk) => reviews.createReviewVotes(chunk))
  }

  logger.info(`Seeding ${WISHLIST_COUNT} wishlists...`)
  const wishlistOwners = rng.pickMany(context.customerIds, WISHLIST_COUNT)
  const createdWishlists = await wishlists.createWishlists(
    wishlistOwners.map((customerId) => ({
      customer_id: customerId,
      name: rng.pick(["My wishlist", "Gifts", "Someday", "Home restock"]),
      is_public: rng.chance(0.2),
      share_token: randomBytes(12).toString("hex"),
    }))
  )

  const wishlistItems = createdWishlists.flatMap((wishlist) =>
    rng.pickMany(context.productIds, rng.int(0, 12)).map((productId) => ({
      wishlist_id: wishlist.id,
      product_id: productId,
      variant_id: null,
      note: rng.chance(0.15) ? "Check size before ordering" : null,
      price_at_add: rng.chance(0.7) ? rng.int(9, 240) : null,
    }))
  )

  if (wishlistItems.length) {
    await inChunks(wishlistItems, (chunk) => wishlists.createWishlistItems(chunk))
  }

  logger.info(`Seeding ${RESTOCK_COUNT} restock subscriptions...`)
  const restockRows = Array.from({ length: RESTOCK_COUNT }, () => {
    const customerIndex = rng.int(0, context.customerIds.length - 1)
    const known = rng.chance(0.7)
    const status = rng.weighted(
      ["active", "notified", "cancelled"] as const,
      [70, 22, 8]
    )

    return {
      variant_id: context.variantIds[rng.zipf(context.variantIds.length, 1.4)],
      product_id: rng.pick(context.productIds),
      customer_id: known ? context.customerIds[customerIndex] : null,
      email: known
        ? context.customerEmails[customerIndex]
        : `waitlist${rng.int(1, 9999)}@example.com`,
      status,
      notified_at: status === "notified" ? rng.dateWithin(60) : null,
    }
  })

  await inChunks(restockRows, (chunk) => restock.createRestockSubscriptions(chunk))

  logger.info(`Seeding ${TICKET_COUNT} support tickets...`)
  const ticketRows = Array.from({ length: TICKET_COUNT }, () => {
    const customerIndex = rng.int(0, context.customerIds.length - 1)
    const status = rng.weighted(
      ["open", "pending", "resolved", "closed"] as const,
      [22, 18, 40, 20]
    )
    const createdAt = rng.dateWithin(120)
    const answered = status !== "open" || rng.chance(0.5)

    return {
      customer_id: context.customerIds[customerIndex],
      email: context.customerEmails[customerIndex],
      order_id:
        context.orderIds.length && rng.chance(0.6) ? rng.pick(context.orderIds) : null,
      subject: rng.pick(TICKET_SUBJECTS),
      category: rng.weighted(
        ["order", "shipping", "return", "product", "billing", "other"] as const,
        [30, 25, 18, 12, 10, 5]
      ),
      status,
      priority: rng.weighted(
        ["low", "normal", "high", "urgent"] as const,
        [20, 55, 20, 5]
      ),
      assigned_to: rng.chance(0.65) ? `agent_${rng.int(1, 6)}` : null,
      first_response_at: answered
        ? new Date(createdAt.getTime() + rng.int(5, 2880) * 60 * 1000)
        : null,
      resolved_at:
        status === "resolved" || status === "closed"
          ? new Date(createdAt.getTime() + rng.int(60, 20160) * 60 * 1000)
          : null,
    }
  })

  const createdTickets = await support.createSupportTickets(ticketRows)

  const ticketMessages = createdTickets.flatMap((ticket) => {
    const turns = rng.int(1, 6)
    return Array.from({ length: turns }, (_, index) => ({
      ticket_id: ticket.id,
      author_type: (index % 2 === 0 ? "customer" : "agent") as
        | "customer"
        | "agent",
      author_id: index % 2 === 0 ? ticket.customer_id : ticket.assigned_to,
      body: rng.pick(TICKET_BODIES),
      is_internal: index % 2 === 1 && rng.chance(0.2),
    }))
  })

  await inChunks(ticketMessages, (chunk) => support.createTicketMessages(chunk))

  logger.info(`Seeding ${PRODUCT_VIEW_COUNT} product views...`)
  const sessions = Array.from({ length: 1200 }, () =>
    randomBytes(8).toString("hex")
  )

  const viewRows = Array.from({ length: PRODUCT_VIEW_COUNT }, () => ({
    product_id: context.productIds[rng.zipf(context.productIds.length, 1.1)],
    variant_id: null,
    customer_id: rng.chance(0.35) ? rng.pick(context.customerIds) : null,
    session_id: rng.pick(sessions),
    source: rng.weighted(
      ["search", "category", "collection", "direct", "recommendation", "email"] as const,
      [30, 25, 12, 18, 10, 5]
    ),
    referrer: rng.chance(0.4) ? "https://www.google.com/" : null,
    country_code: rng.pick(["gb", "de", "dk", "se", "fr", "es", "it"]),
    viewed_at: rng.dateWithin(120),
  }))

  await inChunks(viewRows, (chunk) => analytics.createProductViews(chunk))

  logger.info(`Seeding ${SEARCH_COUNT} search queries...`)
  const searchRows = Array.from({ length: SEARCH_COUNT }, () => {
    // A fifth of searches find nothing — that is what the merchandising gap
    // report exists to surface.
    const missing = rng.chance(0.2)
    const term = missing ? rng.pick(MISSING_SEARCH_TERMS) : rng.pick(SEARCH_TERMS)
    const resultsCount = missing ? 0 : rng.int(1, 60)

    return {
      query: term,
      normalized_query: term.trim().toLowerCase(),
      results_count: resultsCount,
      customer_id: rng.chance(0.3) ? rng.pick(context.customerIds) : null,
      session_id: rng.pick(sessions),
      clicked_product_id:
        resultsCount > 0 && rng.chance(0.45) ? rng.pick(context.productIds) : null,
      country_code: rng.pick(["gb", "de", "dk", "se", "fr", "es", "it"]),
      searched_at: rng.dateWithin(120),
    }
  })

  await inChunks(searchRows, (chunk) => analytics.createSearchQueries(chunk))

  logger.info("Engagement data seeded.")
}
