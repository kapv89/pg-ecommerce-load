import type { Profile } from "./lib/engine"

/**
 * A regular trading day.
 *
 * Read-heavy and unremarkable: almost everyone browses, a third search, one in
 * eight puts something in a basket and a third of those actually buy. Resources
 * should sit comfortably busy and well under saturation, and — importantly for
 * this project — every statement it issues should be one an index can serve.
 * If the baseline contains an unoptimised query then the anomaly is not
 * isolating anything.
 */
export const baseline: Profile = {
  name: "Baseline workload",
  description: "A regular trading day. Moderate load, no sale, no degraded paths.",
  concurrency: 150,
  durationSeconds: Number(process.env.WORKLOAD_DURATION ?? 120),
  rampSeconds: 15,
  // Real visitors read the page before clicking. Think time is what keeps a
  // moderate request rate from becoming an unrealistic hammering.
  thinkTimeMs: [300, 1200],
  authenticatedShare: 0.35,
  customerPoolSize: 25,
  funnel: {
    search: 0.35,
    category: 0.45,
    productViews: [1, 4],
    readReviews: 0.3,
    wishlist: 0.08,
    addToCart: 0.12,
    checkout: 0.35,
    writeReview: 0.02,
    restockSignup: 0.03,
    supportTicket: 0.01,
    adminSession: 0.03,
  },
}

/**
 * Black Friday, with the sale switched on.
 *
 * Three things change at once, which is what a real peak looks like:
 *
 *   1. More people — roughly 4x the concurrency, with less patience (shorter
 *      think time), so request rate rises faster than user count.
 *   2. Different behaviour — they came to buy. Add-to-cart triples and the
 *      checkout rate doubles, moving load from cheap reads onto the expensive
 *      write path.
 *   3. Degraded code paths — the active sale_event row turns on live scarcity
 *      counters, allocation tracking and the per-customer limit check. See
 *      packages/app/src/api/store/storefront/sale-merchandising.ts.
 *
 * Admin traffic goes up too, because that is what actually happens: everyone is
 * watching the dashboards during a sale.
 */
export const anomaly: Profile = {
  name: "Anomalous workload (Black Friday)",
  description:
    "Peak traffic with an active sale. Heavy load, buy-heavy funnel, degraded query paths.",
  concurrency: 160,
  durationSeconds: Number(process.env.WORKLOAD_DURATION ?? 120),
  rampSeconds: 30,
  thinkTimeMs: [50, 400],
  authenticatedShare: 0.55,
  customerPoolSize: 40,
  funnel: {
    search: 0.45,
    category: 0.55,
    productViews: [2, 6],
    readReviews: 0.35,
    wishlist: 0.12,
    addToCart: 0.4,
    checkout: 0.6,
    writeReview: 0.03,
    restockSignup: 0.08,
    supportTicket: 0.02,
    adminSession: 0.06,
  },
}
