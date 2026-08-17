/**
 * Coverage sweep.
 *
 * This is NOT the load generator — it does not model traffic mix, concurrency or
 * think time. It touches every endpoint the app exposes, once, varying filters
 * and sorts so that each distinct query shape gets executed at least once. Its
 * job is to answer "how many distinct normalized queries does this application
 * actually have", which is the number the CMS was chosen for.
 *
 * The realistic load generator is the next piece of work and belongs beside this
 * file; see the README.
 */

// Neither file imports anything, so mark them as modules explicitly —
// otherwise TypeScript treats them as scripts sharing one global scope and the
// two top-level `MEDUSA_URL` declarations collide.
export {}

const MEDUSA_URL = process.env.MEDUSA_URL ?? "http://localhost:9000"
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@ecommerce-load.local"
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "supersecret"

type Json = Record<string, any>

let adminToken = ""
let customerToken = ""
let publishableKey = ""

const stats = { ok: 0, failed: 0 }
const failures: string[] = []

async function call(
  method: string,
  path: string,
  options: { body?: Json; auth?: "admin" | "customer" | "none"; expect?: number[] } = {}
): Promise<Json | null> {
  const headers: Record<string, string> = { "content-type": "application/json" }

  if (options.auth === "admin") {
    headers.authorization = `Bearer ${adminToken}`
  } else if (options.auth === "customer" && customerToken) {
    headers.authorization = `Bearer ${customerToken}`
  }

  if (path.startsWith("/store") && publishableKey) {
    headers["x-publishable-api-key"] = publishableKey
  }

  const res = await fetch(`${MEDUSA_URL}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const allowed = options.expect ?? [200, 201, 204]

  if (!allowed.includes(res.status)) {
    stats.failed++
    const text = await res.text()
    failures.push(`${method} ${path} -> ${res.status} ${text.slice(0, 140)}`)
    return null
  }

  stats.ok++

  if (res.status === 204) {
    return null
  }

  // Medusa serves the admin SPA as a catch-all, so an unmatched path comes back
  // as 200 text/html rather than a 404. Parsing that as JSON throws and kills the
  // sweep, so check the content type first and record it as a failure instead.
  const contentType = res.headers.get("content-type") ?? ""

  if (!contentType.includes("application/json")) {
    stats.ok--
    stats.failed++
    failures.push(`${method} ${path} -> ${res.status} non-JSON (${contentType})`)
    return null
  }

  return (await res.json()) as Json
}

async function authenticate(): Promise<void> {
  const admin = await call("POST", "/auth/user/emailpass", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  adminToken = admin?.token ?? ""

  if (!adminToken) {
    throw new Error(
      `Could not authenticate as ${ADMIN_EMAIL}. Create the user with:\n` +
        `  cd packages/app && npx medusa user -e ${ADMIN_EMAIL} -p ${ADMIN_PASSWORD}`
    )
  }

  const keys = await call("GET", "/admin/api-keys?type=publishable&limit=1", {
    auth: "admin",
  })
  publishableKey = keys?.api_keys?.[0]?.token ?? ""

  // A dedicated customer for the authenticated store routes. Registration is
  // idempotent in effect: if the identity exists we just log in instead.
  const email = "workload-driver@example.com"
  const password = "supersecret"

  const registered = await call("POST", "/auth/customer/emailpass/register", {
    body: { email, password },
    expect: [200, 201, 401, 409, 422],
  })

  if (registered?.token) {
    customerToken = registered.token
    await call("POST", "/store/customers", {
      body: { email, first_name: "Workload", last_name: "Driver" },
      auth: "customer",
      expect: [200, 201, 400, 422],
    })
  }

  const loggedIn = await call("POST", "/auth/customer/emailpass", {
    body: { email, password },
    expect: [200, 201, 401],
  })

  if (loggedIn?.token) {
    customerToken = loggedIn.token
  }
}

async function sweepCore(): Promise<{ productIds: string[]; variantIds: string[] }> {
  // Storefront reads, with the filter and sort combinations a real catalogue
  // page offers. Each combination is its own statement.
  const products = await call("GET", "/store/products?limit=20", { auth: "customer" })
  const productIds: string[] = (products?.products ?? []).map((p: Json) => p.id)
  const variantIds: string[] = (products?.products ?? []).flatMap((p: Json) =>
    (p.variants ?? []).map((v: Json) => v.id)
  )

  const storeSweeps = [
    "/store/products?limit=10&offset=20",
    "/store/products?order=title",
    "/store/products?order=-created_at",
    "/store/products?q=lamp",
    "/store/products?fields=id,title,handle",
    "/store/products?fields=*variants,*variants.calculated_price",
    "/store/product-categories?limit=20",
    "/store/product-categories?include_descendants_tree=true",
    "/store/collections?limit=20",
    "/store/regions",
    "/store/currencies",
    "/store/shipping-options",
  ]

  for (const path of storeSweeps) {
    await call("GET", path, { auth: "customer", expect: [200, 400] })
  }

  const regions = await call("GET", "/store/regions", { auth: "customer" })
  const regionId = regions?.regions?.[0]?.id

  if (productIds.length) {
    await call("GET", `/store/products/${productIds[0]}`, { auth: "customer" })
    // Calculated prices need a pricing context or the API rejects the request.
    if (regionId) {
      await call(
        "GET",
        `/store/products/${productIds[0]}?fields=*variants.calculated_price&region_id=${regionId}`,
        { auth: "customer" }
      )
      await call(
        "GET",
        `/store/products?limit=5&fields=*variants.calculated_price&region_id=${regionId}`,
        { auth: "customer" }
      )
    }
  }

  const adminSweeps = [
    "/admin/products?limit=20",
    "/admin/products?limit=10&order=-created_at",
    "/admin/products?status=published",
    "/admin/products?q=lamp",
    "/admin/product-categories?limit=20",
    "/admin/collections?limit=20",
    "/admin/customers?limit=20",
    "/admin/customers?limit=10&order=-created_at",
    "/admin/customer-groups?limit=20",
    "/admin/orders?limit=20",
    "/admin/orders?limit=10&order=-created_at",
    "/admin/orders?fields=id,total,status,*items",
    "/admin/orders?fields=id,*fulfillments,*fulfillments.items",
    "/admin/orders?fields=id,*shipping_methods,*payment_collections",
    "/admin/inventory-items?limit=20",
    "/admin/reservations?limit=20",
    "/admin/promotions?limit=20",
    "/admin/price-lists?limit=20",
    "/admin/regions?limit=20",
    "/admin/sales-channels?limit=20",
    "/admin/stock-locations?limit=20",
    "/admin/shipping-options?limit=20",
    "/admin/tax-regions?limit=20",
    "/admin/api-keys?limit=10",
    "/admin/users?limit=10",
    "/admin/workflows-executions?limit=20",
    "/admin/notifications?limit=10",
    "/admin/returns?limit=10",
    "/admin/claims?limit=10",
    "/admin/exchanges?limit=10",
    "/admin/draft-orders?limit=10",
    "/admin/return-reasons?limit=10",
    "/admin/product-types?limit=10",
    "/admin/product-tags?limit=10",
    "/admin/shipping-profiles?limit=10",
  ]

  for (const path of adminSweeps) {
    await call("GET", path, { auth: "admin", expect: [200, 400, 404] })
  }

  return { productIds, variantIds }
}

async function sweepCustom(productIds: string[], variantIds: string[]): Promise<void> {
  const productId = productIds[0]
  const variantId = variantIds[0]
  const sessionId = "coverage-session"

  // --- brands -------------------------------------------------------------
  const brands = await call("GET", "/store/brands?limit=10", { auth: "customer" })
  await call("GET", "/store/brands?country_of_origin=gb", { auth: "customer" })

  const handle = brands?.brands?.[0]?.handle
  if (handle) {
    await call("GET", `/store/brands/${handle}`, { auth: "customer" })
  }

  const adminBrands = await call("GET", "/admin/brands?limit=10", { auth: "admin" })
  await call("GET", "/admin/brands?is_active=true", { auth: "admin" })
  await call("GET", "/admin/brands?q=north", { auth: "admin" })

  const created = await call("POST", "/admin/brands", {
    auth: "admin",
    body: { name: "Coverage Brand", handle: `coverage-brand-${Date.now()}` },
  })

  if (created?.brand?.id) {
    await call("GET", `/admin/brands/${created.brand.id}`, { auth: "admin" })
    await call("POST", `/admin/brands/${created.brand.id}`, {
      auth: "admin",
      body: { description: "Updated by the coverage sweep" },
    })
    await call("DELETE", `/admin/brands/${created.brand.id}`, { auth: "admin" })
  }

  // --- reviews ------------------------------------------------------------
  if (productId) {
    for (const sort of ["recent", "rating_desc", "rating_asc", "helpful"]) {
      await call("GET", `/store/products/${productId}/reviews?sort=${sort}`, {
        auth: "customer",
      })
    }
    await call("GET", `/store/products/${productId}/reviews?rating=5`, {
      auth: "customer",
    })
    await call("GET", `/store/products/${productId}/reviews?verified_only=true`, {
      auth: "customer",
    })
    await call("GET", `/store/products/${productId}/reviews?limit=5&offset=5`, {
      auth: "customer",
    })

    await call("POST", `/store/products/${productId}/reviews`, {
      auth: "customer",
      body: {
        author_name: "Coverage Driver",
        title: "Written by the coverage sweep",
        content: "Exercising the review creation workflow end to end.",
        rating: 4,
      },
      expect: [201, 401],
    })
  }

  const adminReviews = await call("GET", "/admin/reviews?limit=10", { auth: "admin" })
  await call("GET", "/admin/reviews?status=pending", { auth: "admin" })
  await call("GET", "/admin/reviews?status=approved&limit=5", { auth: "admin" })
  await call("GET", "/admin/reviews?rating_lte=2", { auth: "admin" })
  await call("GET", "/admin/reviews?reported=true", { auth: "admin" })
  await call("GET", "/admin/reviews?q=quality", { auth: "admin" })

  const reviewId = adminReviews?.reviews?.[0]?.id
  if (reviewId) {
    await call("GET", `/admin/reviews/${reviewId}`, { auth: "admin" })
    await call("POST", `/admin/reviews/${reviewId}`, {
      auth: "admin",
      body: { status: "approved" },
    })
    await call("POST", `/admin/reviews/${reviewId}/response`, {
      auth: "admin",
      body: { body: "Thanks for taking the time to write this." },
    })
    await call("POST", `/store/reviews/${reviewId}/votes`, {
      auth: "customer",
      body: { vote: "helpful", session_id: sessionId },
      expect: [201, 400, 409],
    })
  }

  // --- wishlists ----------------------------------------------------------
  await call("GET", "/store/wishlists", { auth: "customer", expect: [200, 401] })

  const wishlist = await call("POST", "/store/wishlists", {
    auth: "customer",
    body: { name: "Coverage wishlist" },
    expect: [201, 401],
  })

  const wishlistId = wishlist?.wishlist?.id
  if (wishlistId && productId) {
    const item = await call("POST", `/store/wishlists/${wishlistId}/items`, {
      auth: "customer",
      body: { product_id: productId, variant_id: variantId },
      expect: [201, 401],
    })

    if (item?.item?.id) {
      await call(
        "DELETE",
        `/store/wishlists/${wishlistId}/items/${item.item.id}`,
        { auth: "customer", expect: [200, 401] }
      )
    }
  }

  // --- loyalty ------------------------------------------------------------
  await call("GET", "/store/loyalty", { auth: "customer", expect: [200, 401] })
  await call("POST", "/store/loyalty/redeem", {
    auth: "customer",
    body: { points: 10 },
    expect: [201, 400, 401, 404],
  })

  await call("GET", "/admin/loyalty/tiers", { auth: "admin" })
  await call("GET", "/admin/loyalty/accounts?limit=10", { auth: "admin" })
  await call("GET", "/admin/loyalty/accounts?min_balance=100", { auth: "admin" })

  // --- restock ------------------------------------------------------------
  if (variantId && productId) {
    await call("POST", "/store/restock-subscriptions", {
      body: {
        variant_id: variantId,
        product_id: productId,
        email: "coverage@example.com",
      },
    })
  }
  await call("GET", "/store/restock-subscriptions?email=coverage@example.com", {})
  await call("GET", "/admin/restock-subscriptions?limit=10", { auth: "admin" })
  await call("GET", "/admin/restock-subscriptions?status=active", { auth: "admin" })

  // --- support ------------------------------------------------------------
  await call("GET", "/store/support-tickets", { auth: "customer", expect: [200, 401] })

  const ticket = await call("POST", "/store/support-tickets", {
    auth: "customer",
    body: {
      email: "workload-driver@example.com",
      subject: "Coverage sweep ticket",
      category: "order",
      message: "Opened by the coverage sweep.",
    },
    expect: [201, 401],
  })

  const ticketId = ticket?.ticket?.id
  if (ticketId) {
    await call("GET", `/store/support-tickets/${ticketId}/messages`, {
      auth: "customer",
      expect: [200, 401],
    })
    await call("POST", `/store/support-tickets/${ticketId}/messages`, {
      auth: "customer",
      body: { body: "Following up." },
      expect: [201, 401],
    })
  }

  const adminTickets = await call("GET", "/admin/support-tickets?limit=10", {
    auth: "admin",
  })
  await call("GET", "/admin/support-tickets?status=open", { auth: "admin" })
  await call("GET", "/admin/support-tickets?priority=urgent", { auth: "admin" })
  await call("GET", "/admin/support-tickets?unassigned=true", { auth: "admin" })
  await call("GET", "/admin/support-tickets?category=shipping", { auth: "admin" })

  const adminTicketId = adminTickets?.tickets?.[0]?.id
  if (adminTicketId) {
    await call("GET", `/admin/support-tickets/${adminTicketId}`, { auth: "admin" })
    await call("POST", `/admin/support-tickets/${adminTicketId}`, {
      auth: "admin",
      body: { reply: "Looking into this now.", status: "pending" },
    })
    await call("POST", `/admin/support-tickets/${adminTicketId}`, {
      auth: "admin",
      body: { internal_note: "Checked the carrier portal.", priority: "high" },
    })
  }

  // --- analytics ingest ---------------------------------------------------
  if (productId) {
    for (const source of ["search", "category", "direct", "recommendation"]) {
      await call("POST", "/store/analytics/product-views", {
        body: { product_id: productId, session_id: sessionId, source },
      })
    }
  }

  await call("POST", "/store/analytics/searches", {
    body: { query: "Wool Blanket", results_count: 12, session_id: sessionId },
  })
  await call("POST", "/store/analytics/searches", {
    body: { query: "washing machine", results_count: 0, session_id: sessionId },
  })

  // --- insight dashboards -------------------------------------------------
  const insights = [
    "/admin/insights/top-rated-products",
    "/admin/insights/top-rated-products?min_reviews=1&limit=5",
    "/admin/insights/review-distribution",
    `/admin/insights/review-distribution?product_id=${productId ?? ""}`,
    "/admin/insights/top-viewed-products",
    "/admin/insights/top-viewed-products?days=30&source=search",
    "/admin/insights/search-gaps",
    "/admin/insights/search-gaps?days=7",
    "/admin/insights/loyalty-leaderboard",
    "/admin/insights/support-sla",
    "/admin/insights/support-sla?days=7&sla_hours=4",
    "/admin/insights/wishlist-demand",
    "/admin/insights/restock-demand",
    "/admin/insights/product-funnel",
    "/admin/insights/product-funnel?days=7&limit=5",
  ]

  for (const path of insights) {
    await call("GET", path, { auth: "admin" })
  }
}

/**
 * A full storefront checkout.
 *
 * Worth its own pass: checkout is by some distance the widest path in the app,
 * crossing cart, pricing, promotion, tax, inventory reservation, payment and
 * order in a single flow. Leaving it out understates the query surface badly.
 */
async function sweepCheckout(variantIds: string[]): Promise<void> {
  if (!variantIds.length) {
    return
  }

  const regions = await call("GET", "/store/regions", { auth: "customer" })
  const regionId = regions?.regions?.[0]?.id

  if (!regionId) {
    return
  }

  const cart = await call("POST", "/store/carts", {
    auth: "customer",
    body: {
      region_id: regionId,
      email: "workload-driver@example.com",
      items: [{ variant_id: variantIds[0], quantity: 1 }],
    },
    expect: [200, 201, 400],
  })

  const cartId = cart?.cart?.id
  if (!cartId) {
    return
  }

  await call("GET", `/store/carts/${cartId}`, { auth: "customer" })

  if (variantIds[1]) {
    await call("POST", `/store/carts/${cartId}/line-items`, {
      auth: "customer",
      body: { variant_id: variantIds[1], quantity: 2 },
      expect: [200, 201, 400],
    })
  }

  await call("POST", `/store/carts/${cartId}`, {
    auth: "customer",
    body: {
      shipping_address: {
        first_name: "Workload",
        last_name: "Driver",
        address_1: "1 Coverage Street",
        city: "London",
        country_code: "gb",
        postal_code: "EC1A 1BB",
      },
    },
    expect: [200, 400],
  })

  // Promotion application is its own set of reads over the rule tables.
  await call("POST", `/store/carts/${cartId}`, {
    auth: "customer",
    body: { promo_codes: ["WELCOME10"] },
    expect: [200, 400],
  })

  const shippingOptions = await call(
    "GET",
    `/store/shipping-options?cart_id=${cartId}`,
    { auth: "customer", expect: [200, 400] }
  )

  const optionId = shippingOptions?.shipping_options?.[0]?.id
  if (optionId) {
    await call("POST", `/store/carts/${cartId}/shipping-methods`, {
      auth: "customer",
      body: { option_id: optionId },
      expect: [200, 400],
    })
  }

  const paymentCollection = await call("POST", "/store/payment-collections", {
    auth: "customer",
    body: { cart_id: cartId },
    expect: [200, 201, 400],
  })

  const collectionId = paymentCollection?.payment_collection?.id
  if (collectionId) {
    await call(
      "POST",
      `/store/payment-collections/${collectionId}/payment-sessions`,
      {
        auth: "customer",
        body: { provider_id: "pp_system_default" },
        expect: [200, 201, 400],
      }
    )
  }

  const completed = await call("POST", `/store/carts/${cartId}/complete`, {
    auth: "customer",
    expect: [200, 400],
  })

  const orderId = completed?.order?.id
  if (orderId) {
    await call("GET", `/store/orders/${orderId}`, { auth: "customer" })
  }

  await call("GET", "/store/orders?limit=10", {
    auth: "customer",
    expect: [200, 400],
  })
}

async function main(): Promise<void> {
  console.log(`Coverage sweep against ${MEDUSA_URL}`)

  await authenticate()
  const { productIds, variantIds } = await sweepCore()
  await sweepCustom(productIds, variantIds)
  await sweepCheckout(variantIds)

  console.log(`\nRequests: ${stats.ok} ok, ${stats.failed} failed`)

  if (failures.length) {
    console.log("\nFailures:")
    for (const failure of failures) {
      console.log(`  ${failure}`)
    }
  }

  process.exitCode = stats.failed > 0 ? 1 : 0
}

await main()
