/* eslint-disable */
// Trimmed from: src/ui/page_blocks/dashboard/systems/SystemsView/SystemsTable/useSystemsTableColumns.tsx
// Preserves real patterns: formatInt in ProgressBar, formatDuration, getValue() ?? '-'
import { formatInt } from "@/shared/utils/number/formatInt/formatInt";
import { formatDuration } from "@/shared/utils/time/formatDuration/formatDuration";

function usersSeenCell(getValue: () => number) {
  const value = getValue();
  return formatInt(value);
}

function activeTimeCell(getValue: () => number) {
  const value = getValue();
  return formatDuration(value);
}

function defaultColumn(getValue: () => string | null) {
  return getValue() ?? "-";
}

export { usersSeenCell, activeTimeCell, defaultColumn };
