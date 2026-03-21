#!/usr/bin/env bash
# Check a playwright-cli snapshot for error/loading/empty states.
#
# Usage: bash .claude/skills/visual-compare/scripts/vc-check-health.sh <snapshot.yml> [--session-name <name>]
#
# Output: Structured status lines:
#   STATUS:<session>:loaded    -- Page has content
#   STATUS:<session>:loading   -- Page is still loading
#   STATUS:<session>:error     -- Page shows error state
#   STATUS:<session>:signin    -- Page shows sign-in form
#   STATUS:<session>:empty     -- Page loaded but has no data rows
#   DETAIL:<message>           -- Additional context (row count, result text)
#
# Exit codes: 0 = healthy (loaded with data), 1 = problem detected
set -euo pipefail

SNAP="${1:?Usage: vc-check-health.sh <snapshot.yml> [--session-name <name>]}"
SESSION="unknown"
shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session-name) SESSION="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ ! -f "$SNAP" ]]; then
  echo "STATUS:${SESSION}:error"
  echo "DETAIL:Snapshot file not found: $SNAP"
  exit 1
fi

CONTENT=$(cat "$SNAP")
PROBLEM=false

# Check for error states
if echo "$CONTENT" | grep -qi 'Something went wrong'; then
  echo "STATUS:${SESSION}:error"
  echo "DETAIL:Page shows 'Something went wrong'"
  PROBLEM=true
fi

# Check for sign-in page
if echo "$CONTENT" | grep -q 'Sign in\|textbox.*Email\|textbox.*password'; then
  if ! echo "$CONTENT" | grep -q 'row "\|results\|heading.*Activity\|heading.*Productivity\|heading.*Workstreams'; then
    echo "STATUS:${SESSION}:signin"
    echo "DETAIL:Page shows sign-in form"
    PROBLEM=true
  fi
fi

# Check for "Select a team/user" placeholder (no data loaded yet)
if echo "$CONTENT" | grep -q 'Select a team to view data\|Select a user or workstream to view data'; then
  echo "STATUS:${SESSION}:empty"
  echo "DETAIL:No filter selection — data not loaded"
  PROBLEM=true
fi

# Check for 0 results
if echo "$CONTENT" | grep -q '^[[:space:]]*- generic.*: 0 results$'; then
  echo "STATUS:${SESSION}:empty"
  echo "DETAIL:Page loaded but shows 0 results"
  PROBLEM=true
fi

if $PROBLEM; then
  exit 1
fi

# Healthy — report row count and result text
ROW_COUNT=$(echo "$CONTENT" | grep -c 'row "' || true)
RESULT_LINE=$(echo "$CONTENT" | grep -oE 'Showing [0-9]+ to [0-9]+ of [0-9,]+ results' | head -1 || true)
echo "STATUS:${SESSION}:loaded"
echo "DETAIL:rows=${ROW_COUNT} ${RESULT_LINE}"
exit 0
