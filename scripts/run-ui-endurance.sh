#!/usr/bin/env bash
set -euo pipefail
umask 077

suite_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$suite_dir"

if ! command -v node >/dev/null 2>&1; then
  runner_user_home=$(getent passwd "$(id -un)" | cut -d: -f6)
  node_binary=$(find "$runner_user_home/.nvm/versions/node" -mindepth 3 -maxdepth 3 -type f -name node 2>/dev/null | sort -V | tail -n 1)
  if [[ -z "$node_binary" ]]; then
    echo "Node.js 20.16 or newer was not found." >&2
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

exec npm run test:ui-endurance -- "$@"
