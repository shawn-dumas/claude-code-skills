#!/usr/bin/env bash
# Normalize a playwright-cli snapshot YAML for diffing.
# Strips ref IDs, cursor/active attributes, and dev-only elements.
#
# Usage: bash .claude/skills/visual-compare/scripts/vc-normalize.sh <snapshot.yml> [--realtime] [--strip-indent]
#   --realtime       Also normalize ticking duration values (Xh Xmin Xsec)
#   --strip-indent   Remove leading whitespace (for indentation-insensitive comparison)
#
# Output: Normalized YAML to stdout
# Exit codes: 0 = success, 1 = file not found or empty
set -euo pipefail

SNAP="${1:?Usage: vc-normalize.sh <snapshot.yml> [--realtime] [--strip-indent]}"
REALTIME=false
STRIP_INDENT=false
shift
for arg in "$@"; do
  case "$arg" in
    --realtime) REALTIME=true ;;
    --strip-indent) STRIP_INDENT=true ;;
    *) echo "ERROR: Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$SNAP" ]]; then
  echo "ERROR: File not found: $SNAP" >&2
  exit 1
fi

# Build sed arguments array
SED_ARGS=(
  -e 's/\[ref=e[0-9]+\]//g'
  -e 's/ \[cursor=pointer\]//g'
  -e 's/ \[active\]//g'
  -e '/Open Tanstack query devtools/d'
  -e '/Open Next.js Dev Tools/d'
  -e '/Notifications alt+T/d'
)

if $REALTIME; then
  SED_ARGS+=(
    -e 's/[0-9]+h [0-9]+min [0-9]+sec/Xh Xmin Xsec/g'
    -e 's/[0-9]+min [0-9]+sec/Xmin Xsec/g'
    -e 's/[0-9]+sec/Xsec/g'
  )
fi

if $STRIP_INDENT; then
  SED_ARGS+=(-e 's/^ *//')
fi

sed -E "${SED_ARGS[@]}" "$SNAP"
