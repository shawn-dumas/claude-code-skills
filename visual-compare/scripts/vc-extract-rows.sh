#!/usr/bin/env bash
# Extract table data from a playwright-cli snapshot YAML.
#
# Usage: bash .claude/skills/visual-compare/scripts/vc-extract-rows.sh <snapshot.yml> [OPTIONS]
#   --emails    Extract email addresses instead of full rows
#   --results   Extract result count lines instead of rows
#   --headings  Extract heading elements (group names for Per Project/Per BPO)
#   --sorted    Sort output alphabetically
#   --limit N   Limit output to first N lines (default: unlimited)
#
# Output: Extracted lines to stdout, one per line
# Exit codes: 0 = success, 1 = file not found
set -euo pipefail

SNAP="${1:?Usage: vc-extract-rows.sh <snapshot.yml> [--emails] [--results] [--headings] [--sorted] [--limit N]}"
shift
MODE="rows"
DO_SORT=false
LIMIT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --emails) MODE="emails"; shift ;;
    --results) MODE="results"; shift ;;
    --headings) MODE="headings"; shift ;;
    --sorted) DO_SORT=true; shift ;;
    --limit) LIMIT="$2"; shift 2 ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$SNAP" ]]; then
  echo "ERROR: File not found: $SNAP" >&2
  exit 1
fi

case "$MODE" in
  rows)
    OUTPUT=$(grep 'row "' "$SNAP" | sed 's/^ *//' || true)
    ;;
  emails)
    OUTPUT=$(grep 'generic ".*@' "$SNAP" | grep -oE '"[^"]*@[^"]*"' | sed 's/"//g' | sort -u || true)
    ;;
  results)
    OUTPUT=$(grep -oE 'Showing [0-9]+ to [0-9]+ of [0-9,]+ results|[0-9]+ results' "$SNAP" || true)
    ;;
  headings)
    OUTPUT=$(grep -oE 'heading "[^"]*"' "$SNAP" | sed 's/heading "//;s/"$//' || true)
    ;;
esac

if $DO_SORT; then
  OUTPUT=$(echo "$OUTPUT" | sort)
fi

if [[ "$LIMIT" -gt 0 ]]; then
  echo "$OUTPUT" | head -"$LIMIT"
else
  echo "$OUTPUT"
fi
