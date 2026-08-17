# ecommerce-load

A real-world Cloud SQL Postgres workload, built to compare two database triage
approaches on something harder than a handful of queries. See
[prompts/project-context.md](prompts/project-context.md) for the background and
[prompts/cms-choice.md](prompts/cms-choice.md) for why the workload is built on Medusa.

## The workload, and what the anomaly does

The system under test is a Medusa v2 ecommerce marketplace — storefront and back office —
extended with what a real store bolts on: product reviews, wishlists, a loyalty scheme,
restock alerts, support tickets, brands and storefront analytics. It runs on a seeded
catalogue of 184 products, 120 customers and 60 orders placed through real checkout. The
load generator drives it as **sessions rather than endpoints**: a visitor lands, maybe
searches, browses a category, views a few products, occasionally saves one, rarely buys —
with product choice Zipf-distributed, so a few items take most of the traffic and produce
the hot rows a uniform generator would hide. A small share of sessions are back-office
staff working instead. Together that exercises **~450 distinct normalized queries**, which
is the whole point: triage tooling is easy to look good against a five-query benchmark.

The baseline profile is a regular trading day, deliberately clean — every statement it
issues is one an index can serve. The anomaly is Black Friday.

One row changes: `sale_event.status` becomes `active`. That switches on merchandising
code — "N people are viewing this", "only N left" — written as a helper that answers the
question for a single product, then called in a loop over every tile on the page. A
12-product listing therefore issues **24 extra queries, one after another, on the same
connection**. Same build, same routes, same traffic driver; the only difference is a
boolean in the database.

Neither added query is slow. One wraps an indexed timestamp in `date_trunc()`, so the
index stops being usable for the time bound. The other computes a sales leaderboard for
the entire catalogue and then picks one row out of it in JavaScript — so all twelve
iterations do identical work and produce the same answer twelve times. They measure
**1.12ms and 0.69ms mean**. All of their cost is in being called 30,045 times each in a
100-second run, and because these tables sit in memory that cost is CPU, not I/O.

The damage is second-order. Holding a connection across 24 serial round trips instead of
two pushes active Postgres backends from **69 to 241** on a 16-core box, and at that
point every statement in the system slows down — including checkout, which contains no
degraded code and yet tops the latency chart at 4.5s. Both bad queries also grow with
data the sale itself is producing, so it drifts worse the longer the sale runs. Sorting
by "slowest query" finds the victim; only total time and call counts find the loop.
[Full RCA below](#rca-what-actually-goes-wrong-in-the-anomaly).

## Layout

Turborepo monorepo on npm workspaces.

| Package | What it is |
| --- | --- |
| [`packages/app`](packages/app) | A Medusa v2 ecommerce app — the system under test |
| [`packages/workload`](packages/workload) | Scripts that drive the app to produce query load |
| [`packages/infra`](packages/infra) | `docker-compose` for Postgres 18 and Redis |

## Getting started

Requires Node >= 20 and Docker with Compose v2.

```bash
npm install
npm run run:app
```

`run:app` starts the infra, applies migrations, builds, and brings up the pm2
cluster — then exits, leaving the processes running under the pm2 daemon.

- storefront and admin API: <http://localhost:9000>
- admin dashboard: <http://localhost:9000/app>

For iterating on app code, use the single-process dev server with file watching
instead: `npm run -w @ecommerce-load/app dev`.

The admin dashboard needs a user before you can log in. Once, with the server running:

```bash
cd packages/app && npx medusa user -e admin@ecommerce-load.local -p supersecret
```

## Checking it works

```bash
curl -s localhost:9000/health                          # -> OK
npm run status:app                                     # pm2 process table
npm run -w @ecommerce-load/infra psql -- -c "select count(*) from pg_stat_statements;"
docker exec ecommerce-load-redis redis-cli INFO keyspace  # db2/db3 hold BullMQ keys
```

Every response carries an `x-medusa-pid` header naming the process that served
it, so `npm run loadtest` can show how evenly work is spread across the cluster.

## The pm2 cluster

The backend runs as managed processes in two roles, defined in
[ecosystem.config.cjs](ecosystem.config.cjs):

| Process | Mode | Instances (16-core) | Role |
| --- | --- | --- | --- |
| `medusa-server` | pm2 cluster | 8 | HTTP only (`workerMode=server`), all sharing port 9000 |
| `medusa-worker` | pm2 fork | 3 | Background only (`workerMode=worker`) — jobs, subscribers, workflow steps |

Cluster mode means pm2's master owns the listening socket and hands connections
to the instances, so N instances serve one address with no load balancer to run.
The split matters: in Medusa's default `shared` mode every HTTP instance also
registers the cron jobs, so a nightly job would fire once per core.

Sizing scales with the machine — half the cores to servers, a fifth to workers,
the rest left for Postgres, Redis and the OS, since they share this VM. Override
with `MEDUSA_SERVER_INSTANCES` / `MEDUSA_WORKER_INSTANCES`; if Postgres moves off
the box, push servers towards the core count.

Each process opens its own connection pool, so the cluster's total is
`(servers + workers) x pool_max`. `DB_CONNECTION_BUDGET` (default 700) is divided
across the instances to set `pool_max`, against a local Postgres running
`max_connections=900` — leaving ~200 slots for psql, the seed scripts and any
monitoring agent. Raise the budget, not the per-process pool: dividing by the
process count self-regulates, so 8 servers get a pool of 63 each and 16 servers
get 31 each, both landing under the same ceiling. On Cloud SQL, `max_connections` scales with
instance size — check the target tier before raising either.

**Measured on 16 cores**, 64 concurrent clients, read-heavy storefront mix:

| Servers | Throughput | p50 | p90 | p99 |
| --- | --- | --- | --- | --- |
| 1 | 107 req/s | 739ms | 848ms | 1235ms |
| 8 | 248 req/s | 226ms | 494ms | 678ms |

2.3x throughput and a third of the p50 — real, but well short of 8x, because
Postgres and Redis share the box and the database becomes the bottleneck long
before the app does. On a VM with the database elsewhere, expect the curve to
extend further.

```bash
npm run run:app       # build + start the cluster, wait until it serves
npm run status:app    # pm2 process table
npm run logs:app      # tail all processes
npm run restart:app   # rolling reload
npm run stop:app      # stop everything
npm run loadtest -- --duration 30 --concurrency 64
```

## Other commands

```bash
npm run infra:up      # start Postgres and Redis
npm run infra:down    # stop them, keep data
npm run infra:reset   # stop them and delete volumes
npm run db:setup      # seed .env and run migrations
npm run build         # medusa build
npm run workload      # coverage sweep over every endpoint
```

## Workloads

```bash
npm run workload:baseline   # a regular trading day
npm run workload:anomaly    # Black Friday, with the sale switched on
npm run sale -- on|off      # toggle the degraded paths by hand

# one continuous run: 60 minutes of traffic, anomaly from minute 20 to 35
npm run workload:timeline -- --duration 60 --anomaly-start 20 --anomaly-end 35
```

Both drive the same endpoints with the same driver. What differs is the traffic
shape and one row in the database: an `active` sale_event turns on merchandising
code paths that are fine at low volume and pathological at peak. Same build, same
routes — so any difference the triage systems report comes from the workload, not
from the system under it changing.

| | Baseline | Anomaly |
| --- | --- | --- |
| Throughput | 377 req/s | 239 req/s |
| p50 / p99 | 24ms / 552ms | **229ms / 4,788ms** |
| CPU used | ~55% | **~83%** |
| Failures | 0.21% | 0.27% |
| Query shapes covered | 424 | 443 |
| Worst statement (mean) | 12.1ms | 358ms |

(Measured before the heavy analytical reports were limited to one run each; see
the workload README. The CPU row is whole-box and unattributed — see the caveat
at the end of the RCA below.)

Near saturation, not broken — the engine aborts if the rolling failure rate
passes 10%. Details, including the four separately diagnosable problems the
anomaly introduces, in [packages/workload/README.md](packages/workload/README.md).

Seeding the dataset (once, after `run:app` has applied migrations):

```bash
npm run -w @ecommerce-load/app seed            # Medusa foundation
npm run -w @ecommerce-load/app seed:workload   # catalogue, customers, orders, engagement
```

## RCA: what actually goes wrong in the anomaly

The short version: **a listing render acquires 24 extra database round trips, one
after another.** Nothing becomes a slow query. The system slows down because every
storefront request now occupies a database connection roughly an order of
magnitude longer, and the resulting backend pile-up slows down everything else —
including the checkout path, which has no degraded code in it at all.

### 1. The trigger

A single row. `sale_event.status` goes to `active`, and three boolean flags on
that row switch on merchandising behaviour
([sale-event.ts](packages/app/src/modules/sale/models/sale-event.ts)):

| Flag | Turns on | Where |
| --- | --- | --- |
| `live_scarcity_enabled` | "N people are viewing this" / "only N left" per tile | [sale-merchandising.ts](packages/app/src/api/store/storefront/sale-merchandising.ts) |
| `allocation_tracking_enabled` | a counter incremented on every add-to-cart | [sale-cart-hooks.ts](packages/app/src/api/sale-cart-hooks.ts) |
| `per_customer_limit_enabled` | "one sale order per customer per day" check | same |

No deploy, no config change, no different endpoint. The listing route runs the
same code either way; `if (sale?.live_scarcity_enabled)` is the only branch.

### 2. The fan-out, straight from the code

The workload requests listings with `limit=12`
([session.ts:109](packages/workload/src/lib/session.ts#L109)), and
[loadScarcitySignals](packages/app/src/api/store/storefront/sale-merchandising.ts)
is a `for...of` loop with two `await`ed queries per product:

| Request | Statements the sale adds | What they are |
| --- | --- | --- |
| Listing page (12 tiles) | **+24** | 12 x (watchers + leaderboard) |
| Product detail page | **+2** | 1 x both |
| Add to cart | **+1 or +2** | hot-row UPDATE, plus a non-sargable count when the shopper is identifiable |

(Deltas, not totals. The baseline versions of these routes already issue several
statements each — `query.graph` plus a count, plus the review list on the PDP —
and the active-sale lookup itself runs in both workloads, cheaply, on the indexed
`status` column. The per-customer check needs an email, so it only fires for
signed-in shoppers: 1,481 calls against the UPDATE's 1,912 in the measured run.)

The loop is sequential — `await` inside `for...of`, not `Promise.all` — so those
24 extra statements are 24 **serial round trips**, not one batched call. This is
the single most load-bearing detail in the whole RCA, and it is a property of the
loop, not of the SQL.

### 3. The two statements, and why they are invisible

**The watchers count** is non-sargable:

```sql
WHERE v.product_id = ?
  AND date_trunc('minute', v.viewed_at) > now() - interval '10 minutes'
```

`product_view` is indexed on `(product_id, viewed_at)`, but wrapping `viewed_at`
in `date_trunc()` makes the index unusable for the time bound. Postgres can still
seek on `product_id`, then must evaluate the function against every row for that
product. `product_view` is the fastest-growing table in the schema — every PDP
view inserts a row — so **this query gets slower as the run proceeds**.

**The leaderboard aggregate** answers a single-product question by computing the
answer for every product:

```sql
SELECT oli.product_id, sum(oi.quantity)::int AS sold
FROM order_item oi
JOIN order_line_item oli ON ... JOIN "order" o ON ...
WHERE o.created_at >= ?          -- sale start. No product filter.
GROUP BY oli.product_id ORDER BY sold DESC
```

...and then JavaScript picks one row out of the result with `.find()`. There is no
predicate narrowing it to the product being rendered, so **all 12 iterations do
identical work and compute the same result 12 times.** Its cost is proportional to
orders placed since the sale started, so it too **degrades as the run proceeds**.

Measured (100s anomaly run): 30,045 calls each, 33.5s and 20.7s of total execution
time, means of **1.12ms and 0.69ms**. Neither would appear in any "slowest query"
ranking. All of their cost is call count, and because these tables fit in shared
buffers, that cost is CPU rather than I/O — which is why the symptom is a CPU
spike rather than disk wait.

### 4. How that becomes latency

Two mechanisms, and the second is the one that hurts:

**Direct.** A listing render adds 24 serial round trips. At the measured means of
1.12ms and 0.69ms that is ~22ms of pure serialisation added per render, before any
contention and before network time — and it scales with the page size, so a
`limit=50` listing would add 100 round trips.

**Indirect, and dominant.** Connection hold time per storefront request rises by
roughly the same factor. Active Postgres backends went from **69 to 241** across
the two runs. At 241 runnable backends on 16 cores, every backend is now waiting
for CPU, so *every* statement in the system inflates — including statements with
no relationship to the sale.

That is why the latency ranking is misleading. The slowest operations in the
anomaly are the checkout steps:

| Operation | p50 | Degraded by the sale? |
| --- | --- | --- |
| `cart:shipping-method` | 4,679ms | no |
| `cart:complete` | 4,497ms | no |
| `cart:address` | 3,374ms | no |
| `storefront:list` | 850ms | **yes — this is the cause** |
| `storefront:pdp` | 293ms | **yes** |

Checkout is a long multi-statement workflow, so it is the most sensitive victim of
a database that is short of CPU — but it is a victim. Sorting by latency puts the
innocent party at the top and the cause fifth. (Checkout volume also genuinely
rises: the anomaly profile lifts `addToCart` from 0.12 to 0.40 and `checkout` from
0.35 to 0.60, so part of that is real load, not only collateral damage.)

### 5. The feedback loop

This is what makes it an incident rather than a step change:

```
more traffic -> more product_view rows and more sale orders
            -> watchers + leaderboard queries get slower
            -> connections held longer
            -> more concurrent backends competing for CPU
            -> every statement slower  ->  requests take longer  ->  (repeat)
```

Both degraded queries are O(data the sale itself is producing). The system does
not settle at a worse steady state; it drifts downward for as long as the sale is
on. This also shows up after the sale ends — the `recovery` phase of a timeline
run does not immediately return to baseline, because the orders the sale created
are still draining through the workflow queues.

### 6. The hot row, honestly

`UPDATE sale_event SET allocation_reserved = allocation_reserved + ? WHERE id = ?`
targets one row on every cart write, so writers serialise behind a row lock.
**At the concurrency measured here this is mild** — 1,912 calls at a 0.102ms mean,
so it is a real mechanism but not a material contributor to the numbers above. It
bites at higher write concurrency; the knob is `anomaly.funnel.addToCart` in
[profiles.ts](packages/workload/src/profiles.ts). The companion `orders_today`
check (1,481 calls, 0.137ms mean) is non-sargable for the same `date_trunc()`
reason as the watchers query, against a much smaller table.

### 7. What this is a test of

Ranked by mean execution time, the anomaly's two dominant statements do not appear
at all. Ranked by total time, they are the top two. A triage approach that asks
"what is the slowest query" finds the checkout workflow — a real symptom, and the
wrong place to fix. One that reasons about total time, call counts and connection
occupancy finds a loop in a listing route.

**Caveat on the CPU figure.** The `~55% -> ~83%` row in the table above is
whole-box CPU from a development machine that was also running a browser and an
editor, and it is not attributed between Postgres and the Node processes. The
mechanism described here is derived from the code and is not in doubt; the split
of that CPU between the database and the application is not yet measured. Doing so
needs per-process sampling during a run — `vm-run-load.sh` collects
`pg_stat_activity` wait events, which covers the database side.


### What a run produces

`vm-run-load.sh` writes to `runs/<timestamp>/`, and that directory is the input
to whichever triage system is being evaluated:

```
meta.txt              what was run, against what, with which pm2 topology
driver.log            request rates and latency percentiles, per phase
top-statements.txt    30 heaviest statements by total time
statements-final.csv  full pg_stat_statements at the end of the run
samples/              pg_stat_statements + pg_stat_activity every 60s
```

The periodic samples are what make the anomaly window separable after the fact —
a `pg_stat_statements` snapshot taken only at the end has the sale's damage
averaged into an hour of healthy traffic.

## Current state

The application hits the target: **450 distinct normalized queries** measured in
`pg_stat_statements` from a single pass over every endpoint. That is a stock Medusa
v2 store extended with seven custom domain modules (reviews, wishlists, loyalty,
restock alerts, support tickets, brands, storefront analytics), nine aggregate admin
dashboards, four workflows, three subscribers and four scheduled jobs, on a
deterministic seeded dataset of 184 products, 120 customers and 60 orders placed
through real checkout, 41 of which are fulfilled and 32 shipped. Details in [packages/app/README.md](packages/app/README.md).

Both workloads are built and measured — a session-based baseline and a Black
Friday anomaly whose degraded query paths are switched on by a database row.

