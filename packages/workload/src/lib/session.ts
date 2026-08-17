import type { StoreClient } from "./client"
import type { Catalogue } from "./setup"

/**
 * Per-session probabilities, i.e. the shape of the funnel.
 *
 * These are what separate a realistic workload from endpoint hammering: on a
 * normal day almost everyone browses and almost nobody buys, and the database
 * sees a correspondingly read-heavy mix. Turning the checkout rate up is most of
 * what makes the anomaly profile a Black Friday rather than just "more traffic".
 */
export type Funnel = {
  search: number
  category: number
  productViews: [number, number]
  readReviews: number
  wishlist: number
  addToCart: number
  checkout: number
  writeReview: number
  restockSignup: number
  supportTicket: number
  /** Share of sessions that are an admin working rather than a shopper. */
  adminSession: number
}

export type SessionContext = {
  catalogue: Catalogue
  regionId: string | null
  funnel: Funnel
  thinkTimeMs: [number, number]
  /**
   * Which phase of the run this session belongs to. Constant for a single-profile
   * run; changes underneath in-flight sessions during a timeline run, which is
   * the point — the traffic shape steps rather than the driver restarting.
   */
  phase: string
}

const SEARCH_TERMS = [
  "wool blanket", "coffee grinder", "desk lamp", "notebook", "water bottle",
  "leather bag", "linen sheets", "ceramic mug", "merino socks", "kettlebell",
  "washing machine", "gift card",
]

/**
 * The two genuinely expensive analytical reports.
 *
 * `product-funnel` is three CTEs over the three fastest-growing tables and
 * measured a 229ms mean; `top-viewed-products` scans the behaviour table over a
 * window. Both are legitimate reports rather than bugs — but they are things
 * back-office staff open now and then, not continuously, and driving them off
 * session volume made them run every few seconds. That put a 200ms+ statement
 * into the middle of a workload whose entire point is that everything else is
 * fast, and it misrepresents how a real store uses them.
 */
const HEAVY_REPORTS = [
  "/admin/insights/top-viewed-products?days=7",
  "/admin/insights/product-funnel?days=7&limit=10",
] as const

/**
 * Each heavy report runs at most once per phase, in both profiles.
 *
 * The set is module-level and therefore shared by every virtual user in the
 * driver process — "occasionally" is a property of the business, not something
 * that should scale with how many shoppers happen to be browsing. Running them
 * once keeps their query shapes in the workload's coverage without letting them
 * distort its latency profile.
 *
 * Keyed by phase so that a long timeline run — baseline, anomaly, back to
 * baseline — still sees each report once inside each segment, rather than only
 * in whichever segment happened to run first.
 */
const claimedHeavyReports = new Set<string>()

function claimHeavyReport(path: string, phase: string): boolean {
  const key = `${phase}::${path}`
  if (claimedHeavyReports.has(key)) {
    return false
  }
  claimedHeavyReports.add(key)
  return true
}

async function think(client: StoreClient, ctx: SessionContext): Promise<void> {
  const [min, max] = ctx.thinkTimeMs
  const delay = client.rng.int(min, max)
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
}

/**
 * One shopper's visit, start to finish.
 *
 * Every branch below is gated on the funnel, so the same code produces a quiet
 * Tuesday and a Black Friday depending only on the profile it is handed.
 */
export async function runShopperSession(
  client: StoreClient,
  ctx: SessionContext
): Promise<void> {
  const { rng } = client
  const { catalogue, funnel } = ctx
  const sessionId = `vu-${rng.int(1, 1_000_000)}`

  // Landing page.
  await client.call("storefront:list", "GET", "/store/storefront/products?limit=12")
  await client.call("sale:banner", "GET", "/store/sale")
  await think(client, ctx)

  if (rng.chance(funnel.search)) {
    const term = rng.pick(SEARCH_TERMS)
    const results = await client.call<{ products?: unknown[] }>(
      "search",
      "GET",
      `/store/products?q=${encodeURIComponent(term)}&limit=12`
    )
    await client.call("analytics:search", "POST", "/store/analytics/searches", {
      body: {
        query: term,
        results_count: results?.products?.length ?? 0,
        session_id: sessionId,
      },
    })
    await think(client, ctx)
  }

  if (catalogue.categoryIds.length && rng.chance(funnel.category)) {
    const categoryId = rng.pick(catalogue.categoryIds)
    await client.call(
      "storefront:category",
      "GET",
      `/store/storefront/products?limit=12&category_id=${categoryId}`
    )
    await think(client, ctx)
  }

  // Product detail pages. Browsing is Zipf-distributed, so a few products take
  // most of the traffic — which is what produces hot rows and cache skew.
  const [minViews, maxViews] = funnel.productViews
  const viewCount = rng.int(minViews, maxViews)
  const viewedProducts: string[] = []

  for (let i = 0; i < viewCount; i++) {
    const index = rng.zipf(catalogue.productHandles.length, 1.1)
    const handle = catalogue.productHandles[index]
    const productId = catalogue.productIds[index]
    viewedProducts.push(productId)

    await client.call("storefront:pdp", "GET", `/store/storefront/products/${handle}`)
    await client.call("analytics:view", "POST", "/store/analytics/product-views", {
      body: { product_id: productId, session_id: sessionId, source: "category" },
    })

    if (rng.chance(funnel.readReviews)) {
      await client.call(
        "reviews:list",
        "GET",
        `/store/products/${productId}/reviews?limit=10&sort=helpful`
      )
    }

    await think(client, ctx)
  }

  if (!viewedProducts.length) {
    return
  }

  const focusProduct = viewedProducts[0]

  // --- storefront side-quests -------------------------------------------
  // Individually rare, collectively most of the storefront. Without these the
  // workload only exercises the browse-and-buy spine and leaves whole features
  // — brands, loyalty, order history — with no query coverage at all.

  if (rng.chance(0.2)) {
    const brands = await client.call<{ brands?: { handle: string }[] }>(
      "brands:list",
      "GET",
      "/store/brands?limit=12"
    )
    const handle = brands?.brands?.[0]?.handle
    if (handle && rng.chance(0.6)) {
      await client.call("brands:detail", "GET", `/store/brands/${handle}`)
    }
    if (rng.chance(0.3)) {
      await client.call("brands:by-country", "GET", "/store/brands?country_of_origin=gb")
    }
  }

  if (rng.chance(0.15)) {
    await client.call("collections:list", "GET", "/store/collections?limit=20")
  }

  if (rng.chance(0.12)) {
    // Catalogue sorting — each order/field combination is its own statement.
    const variant = rng.pick([
      "/store/products?limit=12&order=title",
      "/store/products?limit=12&order=-created_at",
      "/store/products?limit=12&fields=id,title,handle",
      "/store/product-categories?limit=20&include_descendants_tree=true",
    ])
    await client.call("catalogue:variant", "GET", variant)
  }

  if (client.isAuthenticated && rng.chance(funnel.wishlist)) {
    const wishlists = await client.call<{ wishlists?: { id: string }[] }>(
      "wishlist:list",
      "GET",
      "/store/wishlists",
      { auth: true }
    )
    const wishlistId = wishlists?.wishlists?.[0]?.id
    if (wishlistId) {
      const added = await client.call<{ item?: { id: string } }>(
        "wishlist:add",
        "POST",
        `/store/wishlists/${wishlistId}/items`,
        { auth: true, body: { product_id: focusProduct } }
      )
      // Saving and unsaving are different statements; people do both.
      if (added?.item?.id && rng.chance(0.3)) {
        await client.call(
          "wishlist:remove",
          "DELETE",
          `/store/wishlists/${wishlistId}/items/${added.item.id}`,
          { auth: true }
        )
      }
    } else if (rng.chance(0.4)) {
      await client.call("wishlist:create", "POST", "/store/wishlists", {
        auth: true,
        body: { name: "Saved for later" },
      })
    }
  }

  if (client.isAuthenticated && rng.chance(0.18)) {
    await client.call("loyalty:account", "GET", "/store/loyalty", { auth: true })
    if (rng.chance(0.15)) {
      await client.call("loyalty:redeem", "POST", "/store/loyalty/redeem", {
        auth: true,
        body: { points: 10, description: "Redeemed at checkout" },
      })
    }
  }

  if (client.isAuthenticated && rng.chance(0.2)) {
    const orders = await client.call<{ orders?: { id: string }[] }>(
      "orders:history",
      "GET",
      "/store/orders?limit=10",
      { auth: true }
    )
    const orderId = orders?.orders?.[0]?.id
    if (orderId && rng.chance(0.5)) {
      await client.call("orders:detail", "GET", `/store/orders/${orderId}`, {
        auth: true,
      })
    }
  }

  if (rng.chance(0.1)) {
    const listed = await client.call<{ reviews?: { id: string }[] }>(
      "reviews:browse",
      "GET",
      `/store/products/${focusProduct}/reviews?limit=5&rating=5`
    )
    const reviewId = listed?.reviews?.[0]?.id
    if (reviewId) {
      await client.call("reviews:vote", "POST", `/store/reviews/${reviewId}/votes`, {
        body: { vote: rng.chance(0.85) ? "helpful" : "not_helpful", session_id: sessionId },
      })
    }
  }

  if (client.isAuthenticated && rng.chance(0.08)) {
    const tickets = await client.call<{ tickets?: { id: string }[] }>(
      "support:list",
      "GET",
      "/store/support-tickets?limit=10",
      { auth: true }
    )
    const ticketId = tickets?.tickets?.[0]?.id
    if (ticketId) {
      await client.call(
        "support:messages",
        "GET",
        `/store/support-tickets/${ticketId}/messages`,
        { auth: true }
      )
      if (rng.chance(0.4)) {
        await client.call(
          "support:reply",
          "POST",
          `/store/support-tickets/${ticketId}/messages`,
          { auth: true, body: { body: "Any update on this?" } }
        )
      }
    }
  }

  if (rng.chance(0.06)) {
    await client.call(
      "restock:check",
      "GET",
      `/store/restock-subscriptions?email=${sessionId}@example.com`
    )
  }

  if (rng.chance(funnel.restockSignup)) {
    await client.call("restock:signup", "POST", "/store/restock-subscriptions", {
      body: {
        variant_id: rng.pick(catalogue.variantIds),
        product_id: focusProduct,
        email: `${sessionId}@example.com`,
      },
    })
  }

  if (client.isAuthenticated && rng.chance(funnel.writeReview)) {
    await client.call("reviews:create", "POST", `/store/products/${focusProduct}/reviews`, {
      auth: true,
      body: {
        author_name: "Load Shopper",
        title: "Bought during the run",
        content: "Generated by the workload driver.",
        rating: rng.int(3, 5),
      },
    })
  }

  if (client.isAuthenticated && rng.chance(funnel.supportTicket)) {
    await client.call("support:create", "POST", "/store/support-tickets", {
      auth: true,
      body: {
        email: `${sessionId}@example.com`,
        subject: "Question about my order",
        category: "order",
        message: "Generated by the workload driver.",
      },
    })
  }

  if (!rng.chance(funnel.addToCart) || !ctx.regionId) {
    return
  }

  await runCartSession(client, ctx, sessionId)
}

/**
 * Cart and checkout.
 *
 * Split out because it is the expensive half of the funnel and the half whose
 * rate changes most between the two profiles. The cart writes are also what
 * trigger the sale allocation counter, so this is where lock contention shows up
 * during the anomaly.
 */
async function runCartSession(
  client: StoreClient,
  ctx: SessionContext,
  sessionId: string
): Promise<void> {
  const { rng } = client
  const { catalogue, funnel, regionId } = ctx

  const email = `${sessionId}@example.com`

  const cart = await client.call<{ cart?: { id: string } }>(
    "cart:create",
    "POST",
    "/store/carts",
    {
      auth: true,
      body: {
        region_id: regionId,
        email,
        items: [
          {
            variant_id: catalogue.variantIds[rng.zipf(catalogue.variantIds.length, 1.1)],
            quantity: rng.int(1, 2),
          },
        ],
      },
    }
  )

  const cartId = cart?.cart?.id
  if (!cartId) {
    return
  }

  if (rng.chance(0.4)) {
    await client.call("cart:add-item", "POST", `/store/carts/${cartId}/line-items`, {
      auth: true,
      // No `email` here: the line-items endpoint rejects unknown fields. The
      // sale hook reads it from the cart-create body instead.
      body: {
        variant_id: catalogue.variantIds[rng.zipf(catalogue.variantIds.length, 1.3)],
        quantity: 1,
      },
    })
  }

  await client.call("cart:get", "GET", `/store/carts/${cartId}`, { auth: true })
  await think(client, ctx)

  if (!rng.chance(funnel.checkout)) {
    // Abandoned cart — the majority outcome, and it leaves rows behind.
    return
  }

  await client.call("cart:address", "POST", `/store/carts/${cartId}`, {
    auth: true,
    body: {
      email,
      shipping_address: {
        first_name: "Load",
        last_name: "Shopper",
        address_1: `${rng.int(1, 200)} Test Street`,
        city: "London",
        country_code: "gb",
        postal_code: "EC1A 1BB",
      },
    },
  })

  const options = await client.call<{ shipping_options?: { id: string }[] }>(
    "cart:shipping-options",
    "GET",
    `/store/shipping-options?cart_id=${cartId}`,
    { auth: true }
  )

  const optionId = options?.shipping_options?.[0]?.id
  if (!optionId) {
    return
  }

  await client.call("cart:shipping-method", "POST", `/store/carts/${cartId}/shipping-methods`, {
    auth: true,
    body: { option_id: optionId },
  })

  const collection = await client.call<{ payment_collection?: { id: string } }>(
    "cart:payment-collection",
    "POST",
    "/store/payment-collections",
    { auth: true, body: { cart_id: cartId } }
  )

  const collectionId = collection?.payment_collection?.id
  if (!collectionId) {
    return
  }

  await client.call(
    "cart:payment-session",
    "POST",
    `/store/payment-collections/${collectionId}/payment-sessions`,
    { auth: true, body: { provider_id: "pp_system_default" } }
  )

  await client.call("cart:complete", "POST", `/store/carts/${cartId}/complete`, {
    auth: true,
  })
}

/**
 * Back-office work.
 *
 * Modelled as a catalogue of tasks rather than one fixed script, because that is
 * what a back office is: a merchandiser, a support agent and a fulfilment clerk
 * doing different jobs against the same database. Each session picks a few.
 *
 * The spread matters for query coverage as much as for realism — the admin API
 * is most of the application's surface, and a single scripted admin path would
 * leave the majority of it with no traffic.
 */
type AdminTask = {
  name: string
  weight: number
  run: (client: StoreClient, ctx: SessionContext, admin: { token: string }) => Promise<void>
}

const ADMIN_TASKS: AdminTask[] = [
  {
    name: "orders",
    weight: 10,
    run: async (client, _ctx, admin) => {
      const orders = await client.call<{ orders?: { id: string }[] }>(
        "admin:orders",
        "GET",
        "/admin/orders?limit=20&order=-created_at",
        admin
      )
      const orderId = orders?.orders?.[0]?.id
      if (orderId) {
        await client.call("admin:order-detail", "GET", `/admin/orders/${orderId}`, admin)
      }
      await client.call(
        "admin:orders-expanded",
        "GET",
        "/admin/orders?limit=10&fields=id,total,status,*items,*fulfillments",
        admin
      )
    },
  },
  {
    name: "catalogue",
    weight: 9,
    run: async (client, _ctx, admin) => {
      await client.call("admin:products", "GET", "/admin/products?limit=20", admin)
      await client.call("admin:products-filtered", "GET", "/admin/products?status=published&limit=10", admin)
      if (client.rng.chance(0.4)) {
        await client.call("admin:categories", "GET", "/admin/product-categories?limit=20", admin)
        await client.call("admin:collections", "GET", "/admin/collections?limit=20", admin)
      }
      if (client.rng.chance(0.3)) {
        await client.call("admin:product-types", "GET", "/admin/product-types?limit=10", admin)
        await client.call("admin:product-tags", "GET", "/admin/product-tags?limit=10", admin)
      }
    },
  },
  {
    name: "review-moderation",
    weight: 8,
    run: async (client, _ctx, admin) => {
      const pending = await client.call<{ reviews?: { id: string }[] }>(
        "admin:review-queue",
        "GET",
        "/admin/reviews?status=pending&limit=20",
        admin
      )
      await client.call("admin:reviews-reported", "GET", "/admin/reviews?reported=true&limit=10", admin)
      await client.call("admin:reviews-lowrated", "GET", "/admin/reviews?rating_lte=2&limit=10", admin)
      const reviewId = pending?.reviews?.[0]?.id
      if (reviewId) {
        await client.call("admin:review-detail", "GET", `/admin/reviews/${reviewId}`, admin)
        await client.call("admin:review-moderate", "POST", `/admin/reviews/${reviewId}`, {
          ...admin,
          body: { status: client.rng.chance(0.85) ? "approved" : "rejected" },
        })
        if (client.rng.chance(0.3)) {
          await client.call("admin:review-respond", "POST", `/admin/reviews/${reviewId}/response`, {
            ...admin,
            body: { body: "Thanks for the feedback." },
          })
        }
      }
    },
  },
  {
    name: "support",
    weight: 8,
    run: async (client, _ctx, admin) => {
      const tickets = await client.call<{ tickets?: { id: string }[] }>(
        "admin:tickets",
        "GET",
        "/admin/support-tickets?status=open&limit=20",
        admin
      )
      await client.call("admin:tickets-unassigned", "GET", "/admin/support-tickets?unassigned=true&limit=10", admin)
      await client.call("admin:tickets-urgent", "GET", "/admin/support-tickets?priority=urgent&limit=10", admin)
      const ticketId = tickets?.tickets?.[0]?.id
      if (ticketId) {
        await client.call("admin:ticket-detail", "GET", `/admin/support-tickets/${ticketId}`, admin)
        await client.call("admin:ticket-reply", "POST", `/admin/support-tickets/${ticketId}`, {
          ...admin,
          body: client.rng.chance(0.5)
            ? { reply: "Looking into this now.", status: "pending" }
            : { internal_note: "Checked the carrier portal.", priority: "high" },
        })
      }
    },
  },
  {
    name: "customers",
    weight: 6,
    run: async (client, _ctx, admin) => {
      await client.call("admin:customers", "GET", "/admin/customers?limit=20&order=-created_at", admin)
      await client.call("admin:customer-groups", "GET", "/admin/customer-groups?limit=20", admin)
      if (client.rng.chance(0.5)) {
        await client.call("admin:loyalty-accounts", "GET", "/admin/loyalty/accounts?limit=20", admin)
        await client.call("admin:loyalty-tiers", "GET", "/admin/loyalty/tiers", admin)
      }
    },
  },
  {
    name: "inventory",
    weight: 6,
    run: async (client, _ctx, admin) => {
      await client.call("admin:inventory", "GET", "/admin/inventory-items?limit=20", admin)
      await client.call("admin:reservations", "GET", "/admin/reservations?limit=20", admin)
      await client.call("admin:restock", "GET", "/admin/restock-subscriptions?status=active&limit=20", admin)
      if (client.rng.chance(0.4)) {
        await client.call("admin:stock-locations", "GET", "/admin/stock-locations?limit=10", admin)
      }
    },
  },
  {
    name: "merchandising",
    weight: 5,
    run: async (client, _ctx, admin) => {
      const brands = await client.call<{ brands?: { id: string }[] }>(
        "admin:brands",
        "GET",
        "/admin/brands?limit=20",
        admin
      )
      await client.call("admin:brands-search", "GET", "/admin/brands?q=north&limit=10", admin)
      const brandId = brands?.brands?.[0]?.id
      if (brandId && client.rng.chance(0.4)) {
        await client.call("admin:brand-detail", "GET", `/admin/brands/${brandId}`, admin)
        await client.call("admin:brand-update", "POST", `/admin/brands/${brandId}`, {
          ...admin,
          body: { description: "Updated during the run." },
        })
      }
      await client.call("admin:promotions", "GET", "/admin/promotions?limit=20", admin)
      await client.call("admin:price-lists", "GET", "/admin/price-lists?limit=20", admin)
    },
  },
  {
    name: "fulfilment",
    weight: 5,
    run: async (client, _ctx, admin) => {
      await client.call("admin:returns", "GET", "/admin/returns?limit=10", admin)
      await client.call("admin:claims", "GET", "/admin/claims?limit=10", admin)
      await client.call("admin:exchanges", "GET", "/admin/exchanges?limit=10", admin)
      await client.call("admin:draft-orders", "GET", "/admin/draft-orders?limit=10", admin)
      await client.call("admin:shipping-options", "GET", "/admin/shipping-options?limit=20", admin)
      await client.call("admin:return-reasons", "GET", "/admin/return-reasons?limit=10", admin)
    },
  },
  {
    name: "settings",
    weight: 3,
    run: async (client, _ctx, admin) => {
      await client.call("admin:regions", "GET", "/admin/regions?limit=20", admin)
      await client.call("admin:sales-channels", "GET", "/admin/sales-channels?limit=20", admin)
      await client.call("admin:tax-regions", "GET", "/admin/tax-regions?limit=20", admin)
      await client.call("admin:api-keys", "GET", "/admin/api-keys?limit=10", admin)
      await client.call("admin:users", "GET", "/admin/users?limit=10", admin)
      await client.call("admin:shipping-profiles", "GET", "/admin/shipping-profiles?limit=10", admin)
      await client.call("admin:workflows", "GET", "/admin/workflows-executions?limit=20", admin)
    },
  },
  {
    // The analytics dashboards. Aggregates by nature, so they are the heaviest
    // reads in the back office even when healthy — kept to a low weight so the
    // baseline stays representative of a day rather than of a reporting run.
    name: "insights",
    weight: 4,
    run: async (client, ctx, admin) => {
      // Index-supported aggregates; all measured under 10ms mean.
      const dashboards = [
        "/admin/insights/top-rated-products",
        "/admin/insights/review-distribution",
        "/admin/insights/search-gaps?days=7",
        "/admin/insights/loyalty-leaderboard",
        "/admin/insights/support-sla?days=7",
        "/admin/insights/wishlist-demand",
        "/admin/insights/restock-demand",
      ]

      // One dashboard per visit, not all of them — a merchant opens a page, not
      // a reporting suite.
      const chosen = client.rng.pick(dashboards)
      await client.call("admin:insight", "GET", chosen, admin)
      if (client.rng.chance(0.3)) {
        await client.call("admin:insight", "GET", client.rng.pick(dashboards), admin)
      }

      // The heavy reports, at most once per phase — see claimHeavyReport.
      for (const heavy of HEAVY_REPORTS) {
        if (claimHeavyReport(heavy, ctx.phase)) {
          await client.call("admin:insight-heavy", "GET", heavy, admin)
        }
      }
    },
  },
]

const ADMIN_WEIGHTED: AdminTask[] = ADMIN_TASKS.flatMap((task) =>
  Array.from({ length: task.weight }, () => task)
)

export async function runAdminSession(
  client: StoreClient,
  ctx: SessionContext,
  adminToken: string
): Promise<void> {
  const admin = { token: adminToken }
  const taskCount = client.rng.int(1, 3)
  const done = new Set<string>()

  for (let i = 0; i < taskCount; i++) {
    const task = client.rng.pick(ADMIN_WEIGHTED)
    if (done.has(task.name)) {
      continue
    }
    done.add(task.name)
    await task.run(client, ctx, admin)
    await think(client, ctx)
  }
}
