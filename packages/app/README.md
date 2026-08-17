# @ecommerce-load/app

A Medusa v2 store, extended until it produces the query surface of a real
ecommerce deployment rather than a demo. It is the system under test: the workload
scripts drive it, and the load it puts on Postgres is what the two triage systems
are compared against.

**Measured: 450 distinct normalized queries** in `pg_stat_statements` from a single
pass over every endpoint. See [Measuring](#measuring) below.

## Where the queries come from

Roughly three quarters are Medusa's own — catalogue, cart, checkout, order,
inventory, promotion, tax — and reaching them is a matter of exercising the flows.
The remaining ~110 shapes come from the custom modules below.

Two structural properties of Medusa do most of the work:

- **Module isolation.** Cross-module data is not joined in SQL. A read that spans
  products and brands is two statements plus a stitch in JS, not one join. The
  fan-out is why the shape count is high relative to the schema size.
- **Field selection.** Both the store and admin APIs take `fields`/`expand`, so one
  endpoint emits materially different SQL depending on what the caller asked for.

## Custom modules

Seven modules, 13 tables, each one a thing a real store bolts on:

| Module | Tables | What it adds |
| --- | --- | --- |
| `brand` | `brand` | Merchandising brand, linked to products |
| `review` | `product_review`, `review_response`, `review_vote` | Ratings, moderation, merchant replies, helpfulness |
| `wishlist` | `wishlist`, `wishlist_item` | Saved products with a price snapshot |
| `loyalty` | `loyalty_tier`, `loyalty_account`, `loyalty_transaction` | Points ledger and tiers |
| `restock` | `restock_subscription` | Back-in-stock waitlist |
| `support` | `support_ticket`, `ticket_message` | Post-purchase support with SLA fields |
| `analytics` | `product_view`, `search_query` | Storefront behaviour, the highest-write tables |

Links to core (`src/links/`) cover product↔brand, customer↔loyalty account and
customer↔wishlist. The remaining modules hold ids directly, which is what
high-volume tables usually do — the mix is deliberate, since link resolution and
direct id filtering produce different query shapes.

## Surface

- **33 custom route files** under `src/api`, split between store and admin.
- **9 admin insight endpoints** (`/admin/insights/*`) — hand-written aggregate SQL
  for the dashboards a merchant actually looks at: top-rated products, rating
  distribution, top-viewed products, search gaps, loyalty leaderboard, support SLA,
  wishlist demand, restock demand, and a views→saves→reviews funnel. These are
  where the expensive queries live; the funnel is a three-CTE report over the three
  fastest-growing tables.
- **4 workflows** — create review, award loyalty points, redeem loyalty points,
  notify restock. All with compensation steps.
- **3 subscribers** — `order.placed` awards points, `customer.created` provisions a
  loyalty account and wishlist, `review.created` recomputes the rating rollup.
- **4 scheduled jobs** — expire loyalty points nightly, drain the restock queue
  every 15 minutes, prune analytics nightly, escalate stale tickets hourly.

Customer-scoped store routes are behind `authenticate("customer", …)` in
`src/api/middlewares.ts`; review listings, brand pages, restock signup and the
analytics beacons stay public.

## Seed

Three stages, run in order:

```bash
npm run seed              # Medusa foundation: store, region, sales channel, shipping, tax
npm run seed:workload     # catalogue, customers, loyalty, orders, fulfillments, engagement
npm run seed:orders       # optional: place more orders on an existing dataset
npm run seed:fulfillments # optional: ship orders that do not have a fulfillment yet
```

`npm run db:reset` runs migrations plus the first two.

The dataset is **deterministic**. Everything derives from a fixed PRNG seed
(`src/scripts/workload-seed/random.ts`), so two runs produce the same catalogue,
the same skew and the same row counts. That matters more than it looks: if the two
triage systems see different data, any difference in their conclusions can be
blamed on the data rather than the systems.

Distributions are deliberately uneven, because uniform data hides the problems
worth triaging:

- Product popularity, brand assignment and review counts are Zipf-distributed — a
  few products have hundreds of reviews and the long tail has none.
- Ratings are J-shaped (mostly 5s, a bump of 1s), as real ratings are.
- 12% of variants are seeded out of stock, so the restock queue has real work.
- 20% of searches return zero results, which is what the merchandising gap report
  exists to surface.
- 8% of products are left in draft.

Orders end up in a three-way spread — 32 shipped, 9 fulfilled but not shipped, 19
not fulfilled — so both admin queues have real work in them.

Resulting volumes: 184 products / 611 variants, 120 customers, 60 orders placed
through real checkout, 41 fulfillments / 96 fulfillment items, ~900 reviews with
~900 votes, 212 wishlists / 472 items, 220 restock subscriptions, 160 tickets /
533 messages, 9,000 product views, 2,400 searches.

(Wishlists exceed the 90 the seed creates because the `customer.created`
subscriber also provisions a default one per customer — the same code path that
runs in production.)

## Measuring

```bash
npm run run:app                     # from the repo root
docker exec ecommerce-load-postgres \
  psql -U medusa -d medusa -c "select pg_stat_statements_reset();"
npm run workload                    # from the repo root — coverage sweep
docker exec ecommerce-load-postgres \
  psql -U medusa -d medusa -c "select count(*) from pg_stat_statements;"
```

`npm run workload` is a coverage sweep, not a load generator — it touches all 144
endpoint/filter combinations once. Result: **450 distinct normalized queries**, 389
selects, 43 inserts, 15 updates. Roughly 110 of those shapes touch the custom
module tables.

The real number in production would be higher — the scheduled jobs, the returns and
claims flows, and repeated calls with other filter combinations all add more.

## Two traps in the fulfillment path

Both cost real time; they are documented in `src/scripts/workload-seed/fulfillments.ts`
so the next person does not repeat them.

**`items.quantity` is not always resolved.** Reading an order through `query.graph`
immediately after checkout, in the same process, returns line items with no
`quantity` field at all — no error, the key is simply absent. The same query in a
fresh process returns it. `items.detail.quantity` always carries it, so the seeder
asks for both and reads whichever came back.

**A NaN quantity fails 300 lines from where it was introduced.** Order quantities
are BigNumber-backed, and `Number(wrapper)` is `NaN`. The NaN survives all the way
into the INSERT, where MikroORM renders it unquoted — Postgres then parses it as an
identifier and the error is `column "nan" does not exist`, which says nothing about
quantities. If you hit an unexplained `column "nan"`, look for a numeric coercion,
and turn on statement logging: the failing INSERT names the column immediately.

## Running as a cluster

`npm run run:app` (from the repo root) builds and starts the pm2 topology in
[../../ecosystem.config.cjs](../../ecosystem.config.cjs) — HTTP instances in
cluster mode sharing port 9000, background workers in fork mode. See the root
README for sizing and measured throughput.

`medusa-config.ts` reads two things from the environment for this:
`MEDUSA_WORKER_MODE` per process, and `DB_POOL_MAX`, which pm2 derives by
dividing a connection budget across the instance count.

Three things about this cost real time to work out:

**`medusa start` must run from `.medusa/server`, not from here.** That directory
is what `medusa build` produces, and it holds both the compiled server and the
admin's `index.html`. Started from the source tree the process comes up, answers
`/health` with 200, and then 404s every single route — which reads like a broken
build rather than a wrong working directory. `medusa build` also wipes that
directory, so `.env` has to be copied in on every start; `scripts/start-cluster.mjs`
does that and fails loudly if the build is missing.

**Worker processes bind an HTTP port too.** `medusa start` calls `listen()`
unconditionally; in worker mode the only route it registers is `/health`. Give
every worker its own port (pm2's `increment_var`) or they collide — and if a
worker wins the race for 9000, it answers `/health` 200 while 404ing everything
else, which looks identical to the problem above.

**Connections multiply by instance count.** Each process opens its own pool, so
the cluster's total is `(servers + workers) x pool_max`. With Medusa's default
pool that idled at 87 of Postgres's default 100 connections before anything was
under load. The pool is now sized from `DB_CONNECTION_BUDGET` and the local
Postgres runs with `max_connections=300`. On Cloud SQL, `max_connections` scales
with instance size — check the target tier before raising the budget.

## Redis modules

Medusa defaults caching, event bus, workflow engine and locking to in-memory
implementations. That is not what a real deployment looks like and it changes the
query profile: in-memory caching hides repeat reads that Redis would absorb, and
the in-memory event bus and workflow engine run subscribers inline rather than on
background workers.

`medusa-config.ts` takes a single `REDIS_URL` and fans it out to one Redis logical
database per subsystem, so `redis-cli -n <db> keys '*'` attributes traffic to one
owner:

| DB | Subsystem | Module |
| --- | --- | --- |
| 0 | server | `projectConfig.redisUrl` |
| 1 | caching | `@medusajs/medusa/caching` + `@medusajs/caching-redis` |
| 2 | event bus | `@medusajs/medusa/event-bus-redis` |
| 3 | workflow engine | `@medusajs/medusa/workflow-engine-redis` |
| 4 | locking | `@medusajs/medusa/locking` + `@medusajs/medusa/locking-redis` |

The event bus and workflow engine both drive BullMQ queues, which is the main
reason they do not share a database. Caching uses the Caching Module *provider*
API — `@medusajs/cache-redis` has been deprecated since Medusa 2.11.

## Changes from the stock starter

Bootstrapped from `medusajs/medusa-starter-default` (Medusa 2.18.0).

- Yarn 4 files, the upstream `.github/` workflows and the pnpm-oriented `.npmrc`
  were removed; this repo uses npm workspaces, where Medusa's packages hoist by
  default.
- `.env.template` points at the `@ecommerce-load/infra` Postgres and Redis.
- Added `db:setup` (seeds `.env`, then `medusa db:migrate`) and `run:app`, both
  wired into `turbo.json`.
- Everything above.
