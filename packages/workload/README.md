# @ecommerce-load/workload

Scripts that drive the Medusa application to produce query load.

```bash
npm run workload:baseline   # a regular trading day
npm run workload:anomaly    # Black Friday, with the sale switched on
npm run sale -- on|off      # toggle the degraded paths by hand
npm run workload            # coverage sweep: every endpoint once
npm run loadtest            # raw throughput / core-spread check

# one continuous run with the anomaly window inside it (minutes)
npm run workload:timeline -- --duration 60 --anomaly-start 20 --anomaly-end 35
```

All are turbo tasks and bring the infra up first. Override the run length with
`WORKLOAD_DURATION=300` (seconds; default 120).

## The timeline run

`workload:timeline` is the one to use for an actual comparison, and on a VM it is
what [`vm-run-load.sh`](../../vm-run-load.sh) calls.

Running the baseline and the anomaly as two separate invocations gives two
datasets. Running them as one timeline gives a **before**, which is where any
real triage starts: "it was fine at 10:00 and it is not fine now". The three
phases are `baseline` → `anomaly` → `recovery`, and the driver reports latency
percentiles per phase as well as for the run as a whole.

It is a single driver process throughout. Restarting the driver at the boundary
would empty the connection pools and the caches, so the first minutes of the
anomaly would be measuring a cold start rather than a sale.

Two mechanics make that work (`src/lib/engine.ts`):

- **Virtual users are allocated once, for the peak.** Users beyond the current
  phase's concurrency park rather than exit, so the population steps back up at a
  boundary without paying to create clients again.
- **A conductor walks the schedule on wall-clock time**, independent of the
  virtual users, so a boundary lands where it was asked to land even when the
  system under test is slow enough that sessions are running long.

Phase transitions are picked up by in-flight sessions too, which is the realistic
behaviour: a sale starting does not wait for everyone currently browsing to go
home first.

The `recovery` phase is worth watching rather than ignoring. In a 90s smoke run
it read `p50 32ms / p99 1855ms` against the baseline's `11ms / 200ms` — the sale
is off and the traffic shape is back to normal, but the orders it created are
still draining through the workflow queues. A triage system that declares the
incident over the moment the trigger is removed is calling it too early.

## The two workloads

Both drive **the same endpoints with the same driver**. What differs is the
traffic shape and one row in the database.

| | Baseline | Anomaly |
| --- | --- | --- |
| Virtual users | 150 | 160 |
| Think time | 300-1200ms | 50-400ms |
| Add to cart | 12% of sessions | 40% |
| Checkout | 35% of carts | 60% |
| Admin sessions | 3% | 6% |
| `sale_event` row | none active | **active** |

### Measured (90s runs, 16-core box, 8 server instances)

> Measured before the heavy reports were changed to run once per run. The
> throughput and latency figures are unaffected — measurement showed the reports
> were never in the top 18 operations by latency — but the baseline's
> worst-statement figure will now read ~229ms rather than 12.1ms. Re-run both
> workloads to refresh.

| | Baseline | Anomaly |
| --- | --- | --- |
| Throughput | 377 req/s | 239 req/s |
| p50 latency | 24ms | **229ms** |
| p99 latency | 552ms | **4,788ms** |
| Failure rate | 0.21% | 0.27% |
| CPU used | ~55% | **~83%** |
| Postgres connections | 69 | 241 |
| Distinct query shapes | **424** | **443** |
| Worst statement (mean) | 12.1ms* | 358ms |
| Total database time | 20.6s | **176.1s** |

Throughput *drops* under the anomaly while CPU rises — the system is doing much
more work per request, which is what a real incident looks like. Both stay under
the error threshold: near saturation, not broken.

## What makes the anomaly anomalous

Not "more traffic". Request volume is comparable; the damage comes from code
paths that only run while a `sale_event` row is `active`. The switch is a row,
not a deploy — same build, same routes, same driver — so anything the two triage
systems report differently comes from the workload, not from the system under it
being a different system.

Four distinct, separately diagnosable problems:

| Where | Problem | Signature |
| --- | --- | --- |
| Storefront listing + PDP | **N+1** — scarcity signals loaded per product tile | 30,045 calls for ~1,600 page views |
| Same query | **Whole-leaderboard aggregate** to answer a single-product question | seq scan of `order_item`, 33.5s total |
| Same route | **Non-sargable predicate** — `date_trunc('minute', viewed_at)` | index on the highest-write table unusable |
| Cart writes | **Hot row** — one allocation counter incremented per write | 1,912 updates to one row |
| Cart writes | **Non-sargable predicate** — `date_trunc('day', created_at)` | 1,481 calls, no index usable |

The most interesting property for the comparison: **the two dominant statements
have mean execution times of 1.12ms and 0.69ms.** Individually they look
completely healthy. They account for 54 of the ~62 seconds of database time
purely through call count. A triage approach that sorts by mean latency or asks
for "the slowest query" will not find them; one that reasons about total time and
call counts will. That is a real discriminator between the two systems under test.

Lock contention on the allocation counter is present but mild at this scale
(~21 updates/s to the row, 0.1ms mean). Raising `addToCart` in the anomaly
profile is the knob if you want it to bite harder.

## Query-shape coverage

Both workloads are checked against the coverage sweep's 433 shapes, because a
workload that only exercises the browse-and-buy spine leaves most of the
application with no traffic and gives the triage systems an unrealistically
narrow view.

| | Shapes |
| --- | --- |
| Coverage sweep (every endpoint once) | 433 |
| Baseline | 424 |
| Anomaly | 443 |
| Union of both | 444 |

The workloads exceed the sweep because they exercise write paths the sweep never
reaches — order mutations, review moderation, wishlist churn, sale bookkeeping.

The first version of these profiles covered only 295 and 308 shapes: the shopper
session was a browse-and-buy spine and the admin session was a single fixed
script, so brands, loyalty, order history, support, promotions and most of the
admin API saw no traffic at all. Sessions now take weighted side-quests and admin
work is drawn from a catalogue of ten job-shaped tasks.

## Baseline cleanliness

The baseline is meant to contain no unoptimised operations, and that is checked
rather than assumed. After a full run the **worst statement in the entire
baseline has a 12.1ms mean**, total database time across all 424 shapes is 20.6s,
and the only sequential scans are on tables of =<609 rows where Postgres
correctly prefers them.

### The two heavy reports

`product-funnel` (three CTEs over the three fastest-growing tables, a **229ms
mean**) and `top-viewed-products` are legitimate reports rather than bugs, but
driving them off session volume made them run every few seconds — far more often
than any merchant would open them, and enough to put a 200ms+ statement into the
middle of a workload where nothing else exceeds 12ms.

They now run **at most once per phase, in both workloads** (`HEAVY_REPORTS` /
`claimHeavyReport` in `src/lib/session.ts`). The claim set is module-level and
shared by every virtual user, because "occasionally" is a property of the
business, not something that should scale with how many shoppers are browsing.
Running them once keeps their query shapes in coverage without letting them
distort the latency profile. Keying the claim by phase rather than by run means a
long timeline still sees each report inside each segment, rather than only in
whichever segment happened to come first.

One consequence to be aware of: because the baseline now runs each of them once,
`max(mean_exec_time)` over a baseline run reads ~229ms again rather than 12.1ms.
Their share of total database time is negligible (well under 5%), and a member of
staff opening a report once during a trading day is realistic — but if you are
using worst-statement-mean as the baseline's cleanliness check, read it alongside
total time rather than on its own.

## How the traffic is shaped

`src/lib/session.ts` models sessions, not endpoints. A visitor lands, maybe
searches, browses a category, views one to six products, maybe saves one, maybe
carts, and rarely buys. Product choice is Zipf-distributed, so a few products
take most of the traffic and produce the hot rows and cache skew a uniform
generator would hide.

Everything is driven by a seeded PRNG (`src/lib/random.ts`, the same generator as
the dataset seed), so two runs of the same profile issue the same traffic. Given
the comparison is between two triage systems, an unreproducible workload would
make any difference in their findings unattributable.

`src/lib/engine.ts` ramps virtual users in rather than dropping full concurrency
on a cold cluster, and carries a safety valve: if the rolling 10s failure rate
exceeds 10% it aborts rather than spending the rest of the run hammering a
database that is already refusing connections. `src/anomaly.ts` ends the sale in
a `finally`, so an aborted or interrupted run still leaves the system clean for
the next baseline.

## The other two scripts

**`npm run workload`** — coverage sweep. Touches all 144 endpoint/filter
combinations once to count distinct query shapes. Last measured: **450 distinct
normalized queries**, 389 selects, 43 inserts, 15 updates.

**`npm run loadtest -- --duration 30 --concurrency 64`** — raw throughput and
per-process distribution, using the `x-medusa-pid` response header. Used to
verify the pm2 cluster spreads work across cores: 248 req/s across 8 instances
versus 107 on one.

## Measuring a run

```bash
docker exec ecommerce-load-postgres \
  psql -U medusa -d medusa -c "select pg_stat_statements_reset();"
npm run workload:anomaly
docker exec ecommerce-load-postgres psql -U medusa -d medusa -c "
  select calls, round(total_exec_time::numeric/1000,1) total_s,
         round(mean_exec_time::numeric,2) mean_ms, left(query,70)
  from pg_stat_statements order by total_exec_time desc limit 10;"
```

Any monitoring agent you attach polls these same views and will add its own
statements to the results — see the observability note in the root README.
