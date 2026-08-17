#!/usr/bin/env bash
#
# pg_stat_statements against the Cloud SQL instance, without retyping the
# connection details.
#
#   ./vm-pg-stats.sh reset            # zero the counters before a manual run
#   ./vm-pg-stats.sh top [n]          # heaviest statements by total time (default 20)
#   ./vm-pg-stats.sh slow [n]         # heaviest by mean time — the other ranking
#   ./vm-pg-stats.sh shapes           # count of distinct normalized queries
#   ./vm-pg-stats.sh activity         # what the database is doing right now
#   ./vm-pg-stats.sh dump [file]      # full snapshot to CSV
#   ./vm-pg-stats.sh psql [args...]   # a psql session on the instance
#
# Add --config FILE before the subcommand to use settings from somewhere other
# than vm.env.
#
# `top` and `slow` disagree, and that disagreement is the point of this project:
# the anomaly's two dominant statements have sub-millisecond means and appear
# nowhere in `slow`, while accounting for most of the database time in `top`.
set -euo pipefail

# shellcheck source=vm-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vm-lib.sh"

case "${1:-}" in
  -h|--help|help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

# Leading only, so that everything after the subcommand can be handed to psql.
if [ "${1:-}" = "--config" ]; then
  CONFIG_FILE="$2"
  shift 2
fi

cd "$REPO_ROOT"
load_config
apply_defaults
require_config

have psql || die "psql is not installed — run ./vm-setup.sh"

# The reporting queries would otherwise rank themselves.
FILTER="query NOT LIKE '%pg_stat_statements%'"

COMMAND="${1:-top}"
shift || true

case "$COMMAND" in
  reset)
    if db_psql -c "select pg_stat_statements_reset();" >/dev/null; then
      ok "counters reset"
    else
      die "Reset refused. Cloud SQL allows it for roles with pg_read_all_stats or
   cloudsqlsuperuser — grant one to '$DB_USER', or snapshot with \`dump\` and diff instead."
    fi
    ;;

  top)
    db_psql --pset='pager=off' -c "
      SELECT calls,
             round((total_exec_time / 1000)::numeric, 1) AS total_s,
             round((100 * total_exec_time / nullif(sum(total_exec_time) OVER (), 0))::numeric, 1) AS pct,
             round(mean_exec_time::numeric, 3) AS mean_ms,
             rows,
             left(regexp_replace(query, '\s+', ' ', 'g'), 100) AS query
      FROM pg_stat_statements
      WHERE $FILTER
      ORDER BY total_exec_time DESC
      LIMIT ${1:-20};"
    ;;

  slow)
    db_psql --pset='pager=off' -c "
      SELECT calls,
             round(mean_exec_time::numeric, 2) AS mean_ms,
             round(max_exec_time::numeric, 2) AS max_ms,
             round((total_exec_time / 1000)::numeric, 1) AS total_s,
             left(regexp_replace(query, '\s+', ' ', 'g'), 100) AS query
      FROM pg_stat_statements
      WHERE $FILTER AND calls > 5
      ORDER BY mean_exec_time DESC
      LIMIT ${1:-20};"
    ;;

  shapes)
    db_psql --pset='pager=off' -c "
      SELECT count(*) AS shapes,
             count(*) FILTER (WHERE query ILIKE 'select%') AS selects,
             count(*) FILTER (WHERE query ILIKE 'insert%') AS inserts,
             count(*) FILTER (WHERE query ILIKE 'update%') AS updates,
             count(*) FILTER (WHERE query ILIKE 'delete%') AS deletes,
             round((sum(total_exec_time) / 1000)::numeric, 1) AS total_db_seconds
      FROM pg_stat_statements
      WHERE $FILTER;"
    ;;

  activity)
    db_psql --pset='pager=off' -c "
      SELECT state, wait_event_type, wait_event, count(*),
             round(max(extract(epoch FROM now() - query_start))::numeric, 1) AS oldest_s
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY 1, 2, 3
      ORDER BY count(*) DESC;"
    ;;

  dump)
    OUT="${1:-pg_stat_statements-$(date -u +%Y%m%dT%H%M%SZ).csv}"
    db_psql -c "\copy (SELECT now() AS sampled_at, queryid, calls, rows, total_exec_time, mean_exec_time, stddev_exec_time, max_exec_time, shared_blks_hit, shared_blks_read, shared_blks_dirtied, temp_blks_written, query FROM pg_stat_statements WHERE $FILTER) TO '$OUT' WITH CSV HEADER"
    ok "wrote $OUT"
    ;;

  psql)
    db_psql "$@"
    ;;

  *)
    die "Unknown command: $COMMAND (try: reset, top, slow, shapes, activity, dump, psql)"
    ;;
esac
