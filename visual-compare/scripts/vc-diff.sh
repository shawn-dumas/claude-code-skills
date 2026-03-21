#!/usr/bin/env bash
# Normalize two playwright-cli snapshots and diff them.
#
# Usage: bash .claude/skills/visual-compare/scripts/vc-diff.sh <local.yml> <remote.yml> [OPTIONS]
#   --realtime   Apply realtime duration normalization
#   --rows-only  Extract and diff only table row content (data-focused)
#   --sorted     Sort rows before diffing (order-independent comparison)
#
# Output:
#   "IDENTICAL" when normalized snapshots match
#   diff output when they differ
# Exit codes: 0 = identical, 1 = differences found, 2 = error
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL="${1:?Usage: vc-diff.sh <local.yml> <remote.yml> [--realtime] [--rows-only] [--sorted]}"
REMOTE="${2:?Usage: vc-diff.sh <local.yml> <remote.yml> [--realtime] [--rows-only] [--sorted]}"
shift 2

NORM_ARGS=(--strip-indent)
ROWS_ONLY=false
SORTED=false
for arg in "$@"; do
  case "$arg" in
    --realtime) NORM_ARGS+=(--realtime) ;;
    --rows-only) ROWS_ONLY=true ;;
    --sorted) SORTED=true ;;
    *) echo "ERROR: Unknown option: $arg" >&2; exit 2 ;;
  esac
done

for f in "$LOCAL" "$REMOTE"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: File not found: $f" >&2
    exit 2
  fi
done

LOCAL_NORM=$(bash "$SCRIPT_DIR/vc-normalize.sh" "$LOCAL" "${NORM_ARGS[@]}")
REMOTE_NORM=$(bash "$SCRIPT_DIR/vc-normalize.sh" "$REMOTE" "${NORM_ARGS[@]}")

if $ROWS_ONLY; then
  LOCAL_NORM=$(echo "$LOCAL_NORM" | grep 'row "' || true)
  REMOTE_NORM=$(echo "$REMOTE_NORM" | grep 'row "' || true)
fi

if $SORTED; then
  LOCAL_NORM=$(echo "$LOCAL_NORM" | sort)
  REMOTE_NORM=$(echo "$REMOTE_NORM" | sort)
fi

DIFF_OUTPUT=$(diff <(echo "$LOCAL_NORM") <(echo "$REMOTE_NORM")) || true

if [[ -z "$DIFF_OUTPUT" ]]; then
  echo "IDENTICAL"
  exit 0
else
  echo "$DIFF_OUTPUT"
  exit 1
fi
