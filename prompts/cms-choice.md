# ecommerce-load - CMS Choice

A normalized query is an SQL query stripped of its literals — the form `pg_stat_statements`
records, and the unit any triage tooling reasons about.

So the query:

```sql
select id, username, hashed_password from users where username='foo@bar.com';
```

Becomes the following when normalized:

```sql
select id, username, hashed_password from users where username=$1;
```

Typical test loads generate at most 5 distinct normalized queries.

Real world databases run systems with hundreds, even thousands of distinct normalized queries.

This project needs a load of that second kind.

My thought process is that we can use an Open Source Drupal equivalent for Node.js, preferably in Typescript,
to develop an ecommerce application which when simulated using realistic workload scripts, generate somewhere in the range 300-500 distinct normalized queries.

I have heard stories of developers working on Magento backends and optimizing databases and SQLs to make Magento based systems scale to more and more users.

I am looking to replicate similar story using a Node.js CMS.

Select the top candidate CMSes for this with reason.

## Decision

**Primary: Medusa v2.** **Secondary / contrasting workload: Vendure.**

### Candidates evaluated (verified Aug 2026)

| CMS | Schema size | DB layer | License (core) | Verdict |
|---|---|---|---|---|
| **Medusa v2** | 154 models across 26 modules | MikroORM, REST, app-level joins | MIT (EE materials carved out) | **Chosen** |
| **Vendure** | 77 core entities | TypeORM, GraphQL, NestJS | GPLv3 or commercial | Backup |
| EverShop | ~50 tables, 72 migrations | Raw SQL builder, Postgres-only | GPL-3.0 | Too small |
| Payload v3 | user-defined | Drizzle | MIT | We'd author the app |
| Strapi / Directus | n/a | Knex | EE dirs / MSCL-1.0-GPL | Not commerce |

### Why Medusa v2

The requirement is 300-500 distinct *normalized* queries, not merely a large schema. Medusa v2 is
structurally well suited to producing them:

- **26 isolated modules.** Cross-module data is not joined in SQL — the remote-query layer fetches per
  module and stitches results in JS. This yields many small, structurally distinct statements plus
  genuine N+1 patterns, i.e. exactly the messy real-world shape our current test loads lack.
- **Field selection in the API.** REST endpoints accept `fields`/`expand`, so one endpoint emits
  different SQL shapes per caller. Storefront, Admin, checkout, inventory, promotions and returns each
  contribute their own query families.
- **Postgres-only**, and it expects Redis plus a separate worker process — background job traffic is
  realistic and gives the triage systems non-obvious signal to explain.
- **MIT core**, which avoids the licensing friction of the GPLv3 and source-available alternatives.

### Why Vendure is kept as a secondary

Vendure is the better-engineered codebase and its i18n `_translation` tables produce genuinely heavy
multi-join SQL — a contrasting profile to Medusa's many-shallow-queries shape (deep joins vs. wide
fan-out). GraphQL field selection means distinct-query yield scales with the number of query documents
in the load script. GPLv3-or-commercial licensing is the only reason it is not primary.

EverShop is the truest "Node.js Magento" (Postgres-only, modular, EAV-ish attributes, hand-written SQL
with stable query shapes), but at ~50 tables it is expected to land around 150-250 distinct queries —
short of target.

### Caveats to handle during implementation

1. **Distinct-query count depends on the Postgres version, not just the app.** Before PG 18,
   ORM-generated `IN ($1,$2,$3)` lists register a separate `pg_stat_statements` entry per arity. Medusa
   batches heavily, so we could reach 500 "distinct" queries that are really ~80 shapes. PG 18 squashes
   these into `IN ($1 /*, ... */)` unconditionally (no GUC). Pin the Cloud SQL PG version before
   calibrating, or we will be measuring ORM arity noise.
2. **No CMS reaches 300-500 from browsing alone.** The count comes from breadth of flows: storefront
   browse/search/facets, cart and checkout, admin CRUD, order fulfillment, returns, inventory
   adjustments, promotions, and background workers. The workload script is the real work; the CMS
   choice only sets the ceiling.
3. **Verify the Cloud SQL Query Insights top-N cap.** That is the surface triage tooling actually
   reads. If it truncates at 300-500 distinct queries, that truncation is itself a meaningful
   difference between the approaches under test.
