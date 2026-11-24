#!/usr/bin/env bash
set -euo pipefail
umask 077

suite_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$suite_dir"

if ! command -v node >/dev/null 2>&1; then
  runner_user_home=$(getent passwd "$(id -un)" | cut -d: -f6)
  node_binary=$(find "$runner_user_home/.nvm/versions/node" -mindepth 3 -maxdepth 3 -type f -name node 2>/dev/null | sort -V | tail -n 1)
  if [[ -z "$node_binary" ]]; then
    echo "Node.js 20 or newer was not found." >&2
    exit 2
  fi
  export PATH="$(dirname -- "$node_binary"):$PATH"
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 16) ? 0 : 1)' \
  || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 20.16 or newer and npm are required." >&2
  exit 2
fi

if [[ ! -f .env ]]; then
  echo "Missing $suite_dir/.env; copy .env.example and configure the test target." >&2
  exit 2
fi

profile=${1:-smoke}
shift || true
case "$profile" in
  smoke|full|3.9.2-release|3.11.0-release|restore-drill) ;;
  *) echo "Usage: $0 [smoke|full|3.9.2-release|3.11.0-release|restore-drill] [--scenario name[,name...]]" >&2; exit 2 ;;
esac

endurance_units_to_restore=()
restore_endurance_services() {
  local rc=$?
  if [[ "${#endurance_units_to_restore[@]}" -gt 0 ]]; then
    for unit in "${endurance_units_to_restore[@]}"; do
      systemctl --user start "$unit" >/dev/null 2>&1 || true
    done
  fi
  return "$rc"
}

if [[ "${OSCAR_SKIP_ENDURANCE_HANDOFF:-0}" != "1" ]] \
  && [[ "$profile" != "smoke" ]] \
  && command -v systemctl >/dev/null 2>&1; then
  for unit in oscar-ui-endurance.service oscar-ui-endurance-windows.service; do
    if systemctl --user is-enabled "$unit" >/dev/null 2>&1; then
      endurance_units_to_restore+=("$unit")
    fi
  done
  if [[ "${#endurance_units_to_restore[@]}" -gt 0 ]]; then
    trap restore_endurance_services EXIT INT TERM
    if systemctl --user is-active oscar-ui-endurance.service >/dev/null 2>&1; then
      systemctl --user stop oscar-ui-endurance.service >/dev/null 2>&1 || true
    fi
  fi
fi

npm run "test:$profile" -- "$@"
