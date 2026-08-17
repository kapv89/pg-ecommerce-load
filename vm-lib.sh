#!/usr/bin/env bash
# Shared helpers for the vm-*.sh scripts. Sourced, never executed directly.
#
# Configuration comes from three places, in order of precedence:
#
#   1. Flags        ./vm-start.sh --db-host 10.1.2.3
#   2. Environment  DB_HOST=10.1.2.3 ./vm-start.sh
#   3. vm.env       the file you copied from vm.env.example and edited
#
# So the file holds the boring parts and anything you want to vary for one run
# goes on the command line, which is the way round you want when the same VM is
# pointed at a different Cloud SQL instance for an afternoon.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$REPO_ROOT/vm.env}"

if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'
  C_GREEN=$'\033[32m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_BOLD=""; C_RED=""; C_YELLOW=""; C_GREEN=""; C_DIM=""; C_OFF=""
fi

step() { printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_OFF"; }
info() { printf '    %s\n' "$*"; }
dim()  { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }
ok()   { printf '    %s[ ok ]%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
bad()  { printf '    %s[fail]%s %s\n' "$C_RED" "$C_OFF" "$*"; }
warn() { printf '    %s[warn]%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; }
die()  { printf '\n%s!! %s%s\n\n' "$C_RED" "$*" "$C_OFF" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# `--db-host` -> `DB_HOST`, so every setting is reachable as a flag without a
# case arm per setting.
flag_to_var() { printf '%s' "${1#--}" | tr 'a-z-' 'A-Z_'; }

# Reads vm.env without clobbering anything already set, which is what makes the
# precedence order above work.
load_config() {
  [ -f "$CONFIG_FILE" ] || return 0

  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac

    key="${line%%=*}"
    value="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    key="${key#export}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"

    if [ -z "${!key:-}" ]; then
      export "$key=$value"
    fi
  done < "$CONFIG_FILE"
}

apply_defaults() {
  : "${DB_PORT:=5432}"
  : "${DB_NAME:=medusa}"
  : "${DB_USER:=medusa}"
  : "${DB_SSL:=false}"
  : "${REDIS_PORT:=6379}"
  : "${REDIS_DB_ISOLATION:=true}"
  : "${PORT:=9000}"
  : "${ADMIN_EMAIL:=admin@ecommerce-load.local}"
  : "${ADMIN_PASSWORD:=supersecret}"
  : "${DB_CONNECTION_BUDGET:=700}"
  export DB_PORT DB_NAME DB_USER DB_SSL REDIS_PORT REDIS_DB_ISOLATION PORT
  export ADMIN_EMAIL ADMIN_PASSWORD DB_CONNECTION_BUDGET

  # Nothing on this VM starts containers — Postgres is Cloud SQL and Redis is
  # Memorystore. Without this the turbo tasks would try to `docker compose up`
  # a second, local database and quietly run the workload against the wrong one.
  export SKIP_LOCAL_INFRA=1
  export MEDUSA_URL="${MEDUSA_URL:-http://localhost:$PORT}"
}

require_config() {
  local missing=""
  for var in DB_HOST DB_USER DB_PASSWORD DB_NAME REDIS_HOST; do
    [ -n "${!var:-}" ] || missing="$missing $var"
  done
  if [ -n "$missing" ]; then
    die "Missing required settings:$missing
   Set them in $CONFIG_FILE (copy vm.env.example), or pass them as flags."
  fi
}

urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$1"
}

database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    printf '%s' "$DATABASE_URL"
    return
  fi
  printf 'postgres://%s:%s@%s:%s/%s' \
    "$(urlencode "$DB_USER")" "$(urlencode "$DB_PASSWORD")" \
    "$DB_HOST" "$DB_PORT" "$DB_NAME"
}

redis_url() {
  if [ -n "${REDIS_URL:-}" ]; then
    printf '%s' "$REDIS_URL"
    return
  fi
  local scheme="redis" auth=""
  [ "${REDIS_TLS:-false}" = "true" ] && scheme="rediss"
  # Memorystore AUTH is password-only — no username — which is the `:pass@` form.
  [ -n "${REDIS_PASSWORD:-}" ] && auth=":$(urlencode "$REDIS_PASSWORD")@"
  printf '%s://%s%s:%s' "$scheme" "$auth" "$REDIS_HOST" "$REDIS_PORT"
}

# psql against Cloud SQL with the configured credentials. Callers add their own
# flags: db_psql -c "select 1"
db_psql() {
  local sslmode="prefer"
  [ "${DB_SSL:-false}" = "true" ] && sslmode="require"
  PGPASSWORD="$DB_PASSWORD" PGSSLMODE="$sslmode" PGCONNECT_TIMEOUT=10 \
    psql --host="$DB_HOST" --port="$DB_PORT" \
      --username="$DB_USER" --dbname="$DB_NAME" \
      --no-psqlrc --quiet "$@"
}

# Single scalar out of the database, no headers or padding.
db_scalar() {
  db_psql --tuples-only --no-align -c "$1" 2>/dev/null | tr -d '[:space:]'
}

tcp_reachable() {
  local host="$1" port="$2" timeout="${3:-5}"
  timeout "$timeout" bash -c "echo > /dev/tcp/$host/$port" 2>/dev/null
}

app_healthy() {
  curl -fsS --max-time 5 "${MEDUSA_URL}/health" >/dev/null 2>&1
}

# The address a browser will use to reach the admin dashboard. Asking the
# metadata server beats asking the user to look it up, and the answer has to end
# up in the CORS lists or the dashboard loads and then fails every request.
detect_public_host() {
  if [ -n "${PUBLIC_HOST:-}" ]; then
    printf '%s' "$PUBLIC_HOST"
    return
  fi
  local ip
  ip="$(curl -fsS --max-time 2 -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip' \
    2>/dev/null || true)"
  if [ -z "$ip" ]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "${ip:-localhost}"
}

sudo_if_needed() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif have sudo; then
    sudo "$@"
  else
    die "Need root for: $* (no sudo available)"
  fi
}
