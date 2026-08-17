#!/usr/bin/env bash
#
# Runs a load timeline: baseline traffic for the whole duration, with an anomaly
# window inside it.
#
#   ./vm-run-load.sh <load_duration_minutes> <anomaly_start_minutes> <anomaly_end_minutes>
#   ./vm-run-load.sh 60 20 35
#
# That is sixty minutes of a normal trading day, with Black Friday from minute 20
# to minute 35 and a return to normal afterwards. One driver process throughout,
# so the pools and caches stay warm across the boundaries — the step change is
# the workload changing, not the harness restarting.
#
# Everything is written to runs/<timestamp>/: the driver's own report, periodic
# pg_stat_statements and pg_stat_activity snapshots, and a final statement
# ranking. That directory is the input to whichever triage system is being
# evaluated.
#
# Options:
#   --sample-seconds N  snapshot interval, default 60 (0 disables snapshots)
#   --no-reset          keep existing pg_stat_statements counters
#   --config FILE       read settings from FILE instead of vm.env
set -euo pipefail

# shellcheck source=vm-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vm-lib.sh"

SAMPLE_SECONDS=60
RESET_STATS=1

POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --sample-seconds) SAMPLE_SECONDS="$2"; shift 2 ;;
    --no-reset)       RESET_STATS=0; shift ;;
    --config)         CONFIG_FILE="$2"; shift 2 ;;
    -h|--help)        sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*=*)            export "$(flag_to_var "${1%%=*}")=${1#*=}"; shift ;;
    --*)              [ $# -ge 2 ] || die "Missing value for $1"
                      export "$(flag_to_var "$1")=$2"; shift 2 ;;
    *)                POSITIONAL+=("$1"); shift ;;
  esac
done

if [ "${#POSITIONAL[@]}" -ne 3 ]; then
  die "Usage: ./vm-run-load.sh <load_duration_minutes> <anomaly_start_minutes> <anomaly_end_minutes>
   e.g. ./vm-run-load.sh 60 20 35"
fi

DURATION_MIN="${POSITIONAL[0]}"
ANOMALY_START_MIN="${POSITIONAL[1]}"
ANOMALY_END_MIN="${POSITIONAL[2]}"

is_number() { printf '%s' "$1" | grep -Eq '^[0-9]+([.][0-9]+)?$'; }
for value in "$DURATION_MIN" "$ANOMALY_START_MIN" "$ANOMALY_END_MIN"; do
  is_number "$value" || die "Not a number: $value (all three arguments are minutes)"
done

# Compared with awk because these are allowed to be fractional — a two-minute
# smoke run of `0.5 0.1 0.3` is a reasonable thing to want before committing an
# hour to a real one.
awk_true() { awk "BEGIN { exit !($1) }"; }

awk_true "$DURATION_MIN > 0" || die "load_duration_minutes must be greater than zero"
awk_true "$ANOMALY_START_MIN < $ANOMALY_END_MIN" \
  || die "anomaly_start_minutes ($ANOMALY_START_MIN) must be before anomaly_end_minutes ($ANOMALY_END_MIN)"
awk_true "$ANOMALY_END_MIN <= $DURATION_MIN" \
  || die "anomaly_end_minutes ($ANOMALY_END_MIN) is past the end of the run ($DURATION_MIN)"

cd "$REPO_ROOT"
load_config
apply_defaults
require_config

# ---------------------------------------------------------------------------
step "Preflight"

app_healthy || die "No healthy application at $MEDUSA_URL — start it with ./vm-start.sh"
ok "application responding at $MEDUSA_URL"

HAVE_DB=0
if have psql && [ -n "$(db_scalar 'select 1;' || true)" ]; then
  HAVE_DB=1
  if [ "$(db_scalar "select count(*) from pg_extension where extname = 'pg_stat_statements';")" = "0" ]; then
    db_psql -c "create extension if not exists pg_stat_statements;" >/dev/null 2>&1 || true
  fi

  if [ "$(db_scalar "select count(*) from pg_extension where extname = 'pg_stat_statements';")" = "1" ]; then
    ok "database reachable, pg_stat_statements collecting"
  else
    warn "pg_stat_statements is not available — enable the cloudsql.enable_pg_stat_statements
           flag on the instance. The run will still produce driver metrics."
  fi
else
  warn "no psql access — the run will produce driver metrics but no database snapshots"
fi

# ---------------------------------------------------------------------------
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$REPO_ROOT/runs/$RUN_ID"
mkdir -p "$RUN_DIR/samples"

STATEMENT_COLUMNS="queryid, calls, rows,
  round(total_exec_time::numeric, 2) AS total_exec_ms,
  round(mean_exec_time::numeric, 3) AS mean_exec_ms,
  round(stddev_exec_time::numeric, 3) AS stddev_exec_ms,
  round(max_exec_time::numeric, 2) AS max_exec_ms,
  shared_blks_hit, shared_blks_read, shared_blks_dirtied, temp_blks_written,
  query"

# The snapshot query is itself a statement, so it would otherwise appear in its
# own results and in every subsequent one.
STATEMENT_FILTER="query NOT LIKE '%pg_stat_statements%'"

dump_statements() {
  db_psql -c "\copy (SELECT now() AS sampled_at, $STATEMENT_COLUMNS FROM pg_stat_statements WHERE $STATEMENT_FILTER) TO '$1' WITH CSV HEADER" >/dev/null 2>&1 || true
}

dump_activity() {
  db_psql -c "\copy (SELECT now() AS sampled_at, pid, state, wait_event_type, wait_event, backend_type, now() - query_start AS running_for, left(query, 200) AS query FROM pg_stat_activity WHERE datname = current_database()) TO '$1' WITH CSV HEADER" >/dev/null 2>&1 || true
}

cat > "$RUN_DIR/meta.txt" <<EOF
run_id                  $RUN_ID
started_at_utc          $(date -u +%Y-%m-%dT%H:%M:%SZ)
target                  $MEDUSA_URL
database                $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME
redis                   $REDIS_HOST:$REDIS_PORT
load_duration_minutes   $DURATION_MIN
anomaly_start_minutes   $ANOMALY_START_MIN
anomaly_end_minutes     $ANOMALY_END_MIN
sample_seconds          $SAMPLE_SECONDS
server_instances        $(npx pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s);process.stdout.write(String(l.filter(p=>p.name==="medusa-server"&&p.pm2_env.status==="online").length))}catch{process.stdout.write("?")}})')
cores                   $(nproc)
EOF

step "Run $RUN_ID"
info "$DURATION_MIN minutes total, anomaly from minute $ANOMALY_START_MIN to minute $ANOMALY_END_MIN"
info "writing to runs/$RUN_ID"

# ---------------------------------------------------------------------------
if [ "$HAVE_DB" -eq 1 ]; then
  # Snapshot before resetting either way: if the reset is refused — Cloud SQL
  # only allows it for roles with pg_read_all_stats or cloudsqlsuperuser — the
  # "before" file still makes the run analysable as a diff.
  dump_statements "$RUN_DIR/statements-before.csv"

  if [ "$RESET_STATS" -eq 1 ]; then
    if db_psql -c "select pg_stat_statements_reset();" >/dev/null 2>&1; then
      ok "pg_stat_statements reset"
    else
      warn "could not reset pg_stat_statements — subtract statements-before.csv from the final snapshot"
    fi
  fi
fi

SAMPLER_PID=""
if [ "$HAVE_DB" -eq 1 ] && [ "$SAMPLE_SECONDS" -gt 0 ]; then
  (
    n=0
    while true; do
      n=$((n + 1))
      label="$(printf '%04d' "$n")"
      dump_statements "$RUN_DIR/samples/statements-$label.csv"
      dump_activity "$RUN_DIR/samples/activity-$label.csv"
      sleep "$SAMPLE_SECONDS"
    done
  ) &
  SAMPLER_PID=$!
  ok "sampling every ${SAMPLE_SECONDS}s"
fi

cleanup() {
  if [ -n "$SAMPLER_PID" ]; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
step "Driving load"

set +e
npm run workload:timeline -- \
  --duration "$DURATION_MIN" \
  --anomaly-start "$ANOMALY_START_MIN" \
  --anomaly-end "$ANOMALY_END_MIN" 2>&1 | tee "$RUN_DIR/driver.log"
DRIVER_STATUS=${PIPESTATUS[0]}
set -e

cleanup
SAMPLER_PID=""

# ---------------------------------------------------------------------------
step "Collecting"

if [ "$HAVE_DB" -eq 1 ]; then
  dump_statements "$RUN_DIR/statements-final.csv"

  # Ranked by total time rather than by mean, deliberately. The anomaly's two
  # dominant statements have sub-millisecond means and do their damage through
  # call count alone — a "slowest query" ranking does not show them at all.
  db_psql --pset='pager=off' -c "
    SELECT calls,
           round((total_exec_time / 1000)::numeric, 1) AS total_s,
           round(mean_exec_time::numeric, 3)           AS mean_ms,
           rows,
           left(regexp_replace(query, '\s+', ' ', 'g'), 110) AS query
    FROM pg_stat_statements
    WHERE $STATEMENT_FILTER
    ORDER BY total_exec_time DESC
    LIMIT 30;" > "$RUN_DIR/top-statements.txt" 2>/dev/null || true

  SHAPES="$(db_scalar "select count(*) from pg_stat_statements where $STATEMENT_FILTER;" || echo '?')"
  info "distinct query shapes recorded: $SHAPES"
fi

npx pm2 jlist > "$RUN_DIR/pm2.json" 2>/dev/null || true
printf 'finished_at_utc         %s\nexit_status             %s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DRIVER_STATUS" >> "$RUN_DIR/meta.txt"

step "Done"

printf '\n  runs/%s/\n' "$RUN_ID"
printf '    meta.txt              what was run, against what\n'
printf '    driver.log            request rates and latency percentiles, per phase\n'
if [ "$HAVE_DB" -eq 1 ]; then
  printf '    top-statements.txt    30 heaviest statements by total time\n'
  printf '    statements-final.csv  full pg_stat_statements at the end of the run\n'
  [ "$SAMPLE_SECONDS" -gt 0 ] &&
    printf '    samples/              %s snapshots over time\n' \
      "$(find "$RUN_DIR/samples" -name 'statements-*.csv' | wc -l)"
fi

printf '\n  Per-phase latency table:  tail -40 runs/%s/driver.log\n' "$RUN_ID"
[ "$HAVE_DB" -eq 1 ] &&
  printf '  Heaviest statements:      cat runs/%s/top-statements.txt\n' "$RUN_ID"
printf '\n'

exit "$DRIVER_STATUS"
