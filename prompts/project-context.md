# ecommerce-load

## Context

Automated database triage tooling — anything that reads a database's metrics and query
statistics and tries to say what is wrong with it — is hard to evaluate, because the
workloads it is usually tested against are trivial. A test load that issues four or five
distinct normalized queries does not discriminate between a tool that reasons well and one
that pattern-matches: on a workload that small, almost anything finds the problem.

Real databases run applications with hundreds, often thousands, of distinct normalized
queries. Performance problems there are not "the slow query" — they are a query that looks
individually healthy and runs thirty thousand times, an index that stopped being usable
because a predicate got wrapped in a function, a single hot row that serialises writes. Those
are the cases worth testing a triage approach against, and none of them show up on a
four-query benchmark.

This project builds that missing workload: an ecommerce application with a realistic query
surface, driven by a traffic simulator, in two modes — a healthy baseline and an anomaly whose
degraded code paths are switched on by a row in the database rather than by a deploy. Any
triage approach can then be pointed at the same system in the same two states and judged on
what it actually finds.

The focus is Cloud SQL Postgres. Henceforth referred to as PG or simply "database" in this
project.

## Requirements

- A workload generating 300-500 distinct normalized queries, not 5.
- A baseline in which no unoptimised database operation happens, so that anything found
  during the anomaly is attributable to the anomaly.
- An anomaly that is realistic rather than synthetic: a Black Friday, with the damage coming
  from ordinary business logic that only runs while a sale is live.
- Both reproducible, so that two evaluations of the same tooling see the same traffic.
