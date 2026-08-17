#!/usr/bin/env bash
#
# One-time setup after cloning the repo onto a GCP VM.
#
#   git clone <repo> && cd ecommerce-load && ./vm-setup.sh
#
# Installs what the machine is missing, pulls the npm dependencies, and leaves a
# vm.env for you to fill in with the Cloud SQL and Memorystore details. It does
# not touch the database and does not need credentials — connecting to anything
# is vm-start.sh's job.
#
# Safe to re-run.
set -euo pipefail

# shellcheck source=vm-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vm-lib.sh"

NODE_MAJOR_REQUIRED=20
NODE_MAJOR_INSTALL=22
SKIP_LIMITS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-limits) SKIP_LIMITS=1; shift ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
step "System packages"

if have apt-get; then
  # postgresql-client and redis-tools are not optional niceties here: when a
  # managed database refuses a connection, being able to reach it with psql from
  # the same VM is the difference between "the app is broken" and "the firewall
  # rule is missing". vm-check.sh and vm-pg-stats.sh both use them.
  PACKAGES="curl ca-certificates git build-essential postgresql-client redis-tools"
  MISSING=""
  for pkg in $PACKAGES; do
    dpkg -s "$pkg" >/dev/null 2>&1 || MISSING="$MISSING $pkg"
  done

  if [ -n "$MISSING" ]; then
    info "installing:$MISSING"
    sudo_if_needed apt-get update -qq
    # shellcheck disable=SC2086
    sudo_if_needed env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $MISSING
  fi
  ok "system packages present"
else
  warn "no apt-get — install curl, git, postgresql-client and redis-tools yourself"
fi

# ---------------------------------------------------------------------------
step "Node.js"

NODE_MAJOR=0
if have node; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
fi

if [ "$NODE_MAJOR" -lt "$NODE_MAJOR_REQUIRED" ]; then
  info "installing Node $NODE_MAJOR_INSTALL (found ${NODE_MAJOR:-none}, need >= $NODE_MAJOR_REQUIRED)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR_INSTALL}.x" -o /tmp/nodesource.sh
  sudo_if_needed bash /tmp/nodesource.sh
  sudo_if_needed env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
  rm -f /tmp/nodesource.sh
fi

ok "node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------------------
step "File descriptor limits"

if [ "$SKIP_LIMITS" -eq 1 ]; then
  dim "skipped (--skip-limits)"
else
  # The default soft limit of 1024 is genuinely too low for this workload: the
  # cluster holds hundreds of Postgres connections plus a socket per in-flight
  # request, and when it runs out the failures look like database errors rather
  # than like the local resource limit they are.
  LIMITS_FILE=/etc/security/limits.d/99-ecommerce-load.conf
  if [ ! -f "$LIMITS_FILE" ]; then
    printf '* soft nofile 65535\n* hard nofile 65535\nroot soft nofile 65535\nroot hard nofile 65535\n' \
      | sudo_if_needed tee "$LIMITS_FILE" >/dev/null
    info "wrote $LIMITS_FILE (applies to new logins)"
  fi
  ok "nofile limit configured (current shell: $(ulimit -n))"
fi

# ---------------------------------------------------------------------------
step "Dependencies"

if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
ok "npm workspaces installed"

# ---------------------------------------------------------------------------
step "Configuration"

if [ -f vm.env ]; then
  ok "vm.env already exists — left untouched"
else
  cp vm.env.example vm.env
  chmod 600 vm.env
  ok "created vm.env from the example"
fi

mkdir -p runs

# ---------------------------------------------------------------------------
step "Done"

cat <<EOF

Next:

  1. Fill in the Cloud SQL and Memorystore details:

       nano vm.env

  2. Check the VM can actually reach them:

       ./vm-check.sh

  3. Start the cluster. First time on an empty database, add --seed:

       ./vm-start.sh --seed

  4. Run a load timeline (total, anomaly start, anomaly end — all minutes):

       ./vm-run-load.sh 60 20 35

EOF

if [ "$SKIP_LIMITS" -eq 0 ] && [ "$(ulimit -n)" -lt 65535 ]; then
  warn "log out and back in before step 3 so the raised nofile limit takes effect"
fi
