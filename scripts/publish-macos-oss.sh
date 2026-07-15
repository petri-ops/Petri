#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Local release credentials stay outside Git. Existing environment variables
# (for example in CI) continue to work when this file is absent.
if [[ -f "$ROOT/.biof3-secrets" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.biof3-secrets"
  set +a
fi

exec node "$ROOT/scripts/publish-macos-oss.mjs" "$@"
