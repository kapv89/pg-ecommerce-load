# @ecommerce-load/infra

Local infrastructure the Medusa application depends on.

| Service | Image | Default port | Purpose |
| --- | --- | --- | --- |
| `postgres` | `postgres:18` | 5432 | The database under test |
| `redis` | `redis:8-alpine` | 6379 | Medusa caching, event bus, workflow engine and locking |

## Commands

Run from the repo root:

```bash
npm run infra:up      # start and wait for healthy
npm run infra:down    # stop, keep data
npm run infra:reset   # stop and delete volumes
```

Or from this package: `npm run ps`, `npm run logs`, `npm run psql`.

`run:app` at the repo root starts this automatically, so you rarely need `infra:up`
directly.

## Postgres configuration

`pg_stat_statements` is preloaded and the extension is created on first boot, because
it is the same surface Cloud SQL Query Insights exposes and therefore what both triage
systems under comparison actually read. `track = all` also captures statements executed
inside functions, and `pg_stat_statements.max = 10000` keeps the 300-500 distinct
normalized queries we are targeting from being evicted.

**The Postgres major version is load-bearing for this project.** Before 18, an
ORM-generated `IN ($1,$2,$3)` registers a separate `pg_stat_statements` entry per list
length; Medusa batches heavily, so on an older major we would count ORM arity noise
rather than real query shapes. 18 squashes those into a single `IN ($1 /*, ... */)`
entry. Override with `POSTGRES_VERSION` only when deliberately testing that difference.

## Overrides

Every port, credential and image tag reads from the environment, so a conflicting local
Postgres is not a blocker:

```bash
POSTGRES_PORT=55432 REDIS_PORT=56379 npm run infra:up
```

Set the same values in `packages/app/.env` so Medusa points at the right port.
