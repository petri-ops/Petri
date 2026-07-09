#!/usr/bin/env bash
# Pin and verify vendor/biof3-core submodule HEAD.
#
# Usage:
#   ./scripts/sync-vendor.sh          # verify (default)
#   ./scripts/sync-vendor.sh check    # explicit verify
#   ./scripts/sync-vendor.sh update   # write current vendor HEAD into .vendor-lock
#   ./scripts/sync-vendor.sh status   # show expected vs actual
#
# Exit codes:
#   0 = in sync (or update succeeded)
#   1 = drifted
#   2 = .vendor-lock missing and HEAD unknown

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

VENDOR_DIR="vendor/biof3-core"
LOCK_FILE=".vendor-lock"

usage() {
  cat <<'EOF'
sync-vendor.sh — pin or verify vendor submodule HEAD

Subcommands:
  (default), check   Verify vendor HEAD matches .vendor-lock (exit 1 if drifted)
  update             Write the current vendor HEAD into .vendor-lock
  status             Show expected vs actual HEAD (no exit change)
EOF
}

# Ensure submodule is present and initialized.
if [ ! -d "$VENDOR_DIR/.git" ] && [ ! -f "$VENDOR_DIR/.git" ]; then
  echo "[sync-vendor] $VENDOR_DIR is not initialized. Run: git submodule update --init $VENDOR_DIR" >&2
  exit 2
fi

ACTUAL=$(git -C "$VENDOR_DIR" rev-parse HEAD 2>/dev/null || echo "")

if [ -z "$ACTUAL" ]; then
  echo "[sync-vendor] failed to read HEAD from $VENDOR_DIR" >&2
  exit 2
fi

cmd="${1:-check}"

case "$cmd" in
  -h|--help|help)
    usage
    exit 0
    ;;
  status)
    if [ -f "$LOCK_FILE" ]; then
      EXPECTED=$(tr -d '[:space:]' < "$LOCK_FILE")
    else
      EXPECTED="(no .vendor-lock)"
    fi
    echo "expected: $EXPECTED"
    echo "actual:   $ACTUAL"
    if [ -f "$LOCK_FILE" ] && [ "$(tr -d '[:space:]' < "$LOCK_FILE")" = "$ACTUAL" ]; then
      echo "status:   in sync"
    else
      echo "status:   DRIFTED"
    fi
    ;;
  update)
    echo "$ACTUAL" > "$LOCK_FILE"
    echo "[sync-vendor] wrote $ACTUAL to $LOCK_FILE"
    ;;
  check|"")
    if [ ! -f "$LOCK_FILE" ]; then
      echo "[sync-vendor] $LOCK_FILE missing. Run './scripts/sync-vendor.sh update' to create it." >&2
      exit 2
    fi
    EXPECTED=$(tr -d '[:space:]' < "$LOCK_FILE")
    if [ "$EXPECTED" != "$ACTUAL" ]; then
      echo "[sync-vendor] DRIFT detected:" >&2
      echo "  expected: $EXPECTED" >&2
      echo "  actual:   $ACTUAL" >&2
      echo "[sync-vendor] run './scripts/sync-vendor.sh update' to accept the new HEAD," >&2
      echo "[sync-vendor] or commit+push the submodule's upstream first." >&2
      exit 1
    fi
    echo "[sync-vendor] OK ($ACTUAL)"
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac
