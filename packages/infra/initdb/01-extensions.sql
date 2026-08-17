-- Runs once, on first initialisation of the postgres volume.
--
-- pg_stat_statements is what Cloud SQL Query Insights and our triage systems both
-- read, so the local database exposes the same surface.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
