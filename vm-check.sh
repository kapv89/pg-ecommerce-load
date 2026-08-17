#!/usr/bin/env bash
#
# Verifies the VM is in a state where a run means something.
#
#   ./vm-check.sh
#
# Checks the toolchain, the Cloud SQL and Memorystore connections, whether the
# database is migrated and seeded, whether pg_stat_statements is collecting, and
# whether the pm2 cluster is up and spreading requests across its processes.
#
# Run it after ./vm-setup.sh to catch networking problems before they look like
# application bugs, and after ./vm-start.sh to confirm the cluster is healthy
# before committing an hour to a load run. Exits non-zero if anything failed.
set -euo pipefail

# shellcheck source=vm-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vm-lib.sh"

while [ $# -gt 0 ]; do
  case "$1" in
    --config)  CONFIG_FILE="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*=*)     export "$(flag_to_var "${1%%=*}")=${1#*=}"; shift ;;
    --*)       [ $# -ge 2 ] || die "Missing value for $1"
               export "$(flag_to_var "$1")=$2"; shift 2 ;;
    *)         die "Unexpected argument: $1" ;;
  esac
done

cd "$REPO_ROOT"
load_config
apply_defaults

FAILURES=0
fail() { bad "$*"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
step "Toolchain"

if have node; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$NODE_MAJOR" -ge 20 ]; then ok "node $(node -v)"; else fail "node $(node -v) — need >= 20"; fi
else
  fail "node is not installed — run ./vm-setup.sh"
fi

[ -d node_modules ] && ok "dependencies installed" || fail "no node_modules — run ./vm-setup.sh"
have psql && ok "psql $(psql --version | awk '{print $3}')" || warn "no psql — database checks and run snapshots will be skipped"
have redis-cli && ok "redis-cli present" || warn "no redis-cli — the Redis check will fall back to a bare TCP probe"

# ---------------------------------------------------------------------------
step "Configuration"

if [ -f "$CONFIG_FILE" ]; then ok "$CONFIG_FILE"; else fail "no $CONFIG_FILE — copy vm.env.example"; fi

for var in DB_HOST DB_USER DB_PASSWORD DB_NAME REDIS_HOST; do
  [ -n "${!var:-}" ] && ok "$var set" || fail "$var is not set"
done

# ---------------------------------------------------------------------------
step "Cloud SQL"

if [ -n "${DB_HOST:-}" ] && tcp_reachable "$DB_HOST" "$DB_PORT"; then
  ok "tcp $DB_HOST:$DB_PORT open"

  if have psql; then
    if [ -n "$(db_scalar 'select 1;' || true)" ]; then
      ok "authenticated as $DB_USER on $DB_NAME"
      info "server        $(db_scalar 'show server_version;')"

      MAX_CONN="$(db_scalar 'show max_connections;')"
      IN_USE="$(db_scalar 'select count(*) from pg_stat_activity;')"
      info "connections   $IN_USE in use of $MAX_CONN"

      # The cluster's ceiling is the budget; anything above it is Cloud SQL's own
      # reserved backends, psql sessions and Query Insights. A budget above
      # max_connections does not fail at startup — it fails under load, as
      # "sorry, too many clients already" in the middle of a run.
      if [ "${DB_CONNECTION_BUDGET:-0}" -ge "${MAX_CONN:-0}" ]; then
        fail "DB_CONNECTION_BUDGET ($DB_CONNECTION_BUDGET) >= max_connections ($MAX_CONN)"
      else
        ok "connection budget $DB_CONNECTION_BUDGET fits under max_connections $MAX_CONN"
      fi

      if [ "$(db_scalar "select count(*) from pg_extension where extname='pg_stat_statements';")" = "1" ]; then
        ok "pg_stat_statements installed, $(db_scalar 'select count(*) from pg_stat_statements;') shapes recorded"
        TRACK="$(db_scalar 'show pg_stat_statements.track;' || echo '?')"
        if [ "$TRACK" = "all" ]; then
          ok "pg_stat_statements.track = all"
        else
          warn "pg_stat_statements.track = $TRACK — set it to 'all' on the instance to capture
           statements inside functions, as the local docker-compose does"
        fi
      else
        fail "pg_stat_statements is not installed — the whole comparison reads from it.
           Enable the cloudsql.enable_pg_stat_statements flag on the instance,
           then: CREATE EXTENSION pg_stat_statements;"
      fi

      TABLES="$(db_scalar "select count(*) from information_schema.tables where table_schema='public';")"
      if [ "${TABLES:-0}" -gt 50 ]; then
        ok "schema migrated ($TABLES tables)"
        PRODUCTS="$(db_scalar 'select count(*) from product where deleted_at is null;' || echo 0)"
        ORDERS="$(db_scalar 'select count(*) from "order" where deleted_at is null;' || echo 0)"
        if [ "${PRODUCTS:-0}" -gt 100 ]; then
          ok "dataset seeded ($PRODUCTS products, $ORDERS orders)"
        else
          fail "only $PRODUCTS products — run ./vm-start.sh --seed"
        fi
      else
        fail "schema not migrated ($TABLES tables) — run ./vm-start.sh"
      fi
    else
      fail "port is open but authentication failed — check DB_USER / DB_PASSWORD / DB_NAME"
    fi
  fi
else
  fail "cannot reach $DB_HOST:$DB_PORT — check the VPC, the authorised networks and the firewall"
fi

# ---------------------------------------------------------------------------
step "Memorystore"

if [ -n "${REDIS_HOST:-}" ] && tcp_reachable "$REDIS_HOST" "$REDIS_PORT"; then
  ok "tcp $REDIS_HOST:$REDIS_PORT open"
  if have redis-cli; then
    REDIS_ARGS=(-h "$REDIS_HOST" -p "$REDIS_PORT")
    [ -n "${REDIS_PASSWORD:-}" ] && REDIS_ARGS+=(-a "$REDIS_PASSWORD" --no-auth-warning)
    [ "${REDIS_TLS:-false}" = "true" ] && REDIS_ARGS+=(--tls)
    if [ "$(redis-cli "${REDIS_ARGS[@]}" ping 2>/dev/null)" = "PONG" ]; then
      ok "responds to PING"
      if [ "${REDIS_DB_ISOLATION:-true}" = "true" ]; then
        if redis-cli "${REDIS_ARGS[@]}" -n 4 ping >/dev/null 2>&1; then
          ok "logical databases available (the app uses 0-4)"
        else
          fail "database 4 is not selectable — set REDIS_DB_ISOLATION=false (cluster mode has only db 0)"
        fi
      fi
    else
      fail "no PONG — check REDIS_PASSWORD / REDIS_TLS"
    fi
  fi
else
  fail "cannot reach $REDIS_HOST:$REDIS_PORT — Memorystore is private-IP only, so the VM must be on the authorised network"
fi

# ---------------------------------------------------------------------------
step "Application"

if app_healthy; then
  ok "$MEDUSA_URL/health"

  # Ten requests, counting distinct responding pids. One pid means the cluster
  # is not spreading, which on a large VM is most of the capacity gone.
  PIDS="$(for _ in $(seq 10); do
    curl -fsS -o /dev/null -D - --max-time 5 "$MEDUSA_URL/health" 2>/dev/null \
      | tr -d '\r' | awk 'tolower($1) == "x-medusa-pid:" {print $2}'
  done | sort -u | wc -l)"
  if [ "$PIDS" -gt 1 ]; then
    ok "requests spread across $PIDS server processes"
  else
    warn "10 requests all served by $PIDS process — check npm run status:app"
  fi

  if have npx; then
    npx pm2 jlist 2>/dev/null | node -e '
      let s = ""
      process.stdin.on("data", d => s += d).on("end", () => {
        try {
          const list = JSON.parse(s)
          const count = (name, status) =>
            list.filter(p => p.name === name && p.pm2_env.status === status).length
          console.log(`    servers       ${count("medusa-server", "online")} online, ${count("medusa-server", "errored")} errored`)
          console.log(`    workers       ${count("medusa-worker", "online")} online, ${count("medusa-worker", "errored")} errored`)
          const restarts = list.reduce((n, p) => n + (p.pm2_env.restart_time || 0), 0)
          console.log(`    restarts      ${restarts} since start`)
        } catch { console.log("    pm2 status unavailable") }
      })' || true
  fi

  if [ -n "${ADMIN_EMAIL:-}" ]; then
    if curl -fsS --max-time 10 -X POST "$MEDUSA_URL/auth/user/emailpass" \
        -H 'content-type: application/json' \
        -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" >/dev/null 2>&1; then
      ok "admin login works ($ADMIN_EMAIL) — the workload driver can authenticate"
    else
      fail "admin login failed for $ADMIN_EMAIL — the workload driver needs it.
           cd packages/app && npx medusa user -e $ADMIN_EMAIL -p $ADMIN_PASSWORD"
    fi
  fi
else
  warn "no application at $MEDUSA_URL — start it with ./vm-start.sh"
fi

# ---------------------------------------------------------------------------
if [ "$FAILURES" -eq 0 ]; then
  step "All checks passed"
  printf '\n    Ready. Start a run:  ./vm-run-load.sh 60 20 35\n\n'
else
  step "$FAILURES check(s) failed"
  printf '\n'
  exit 1
fi
