/* eslint-disable */
// Fixture: null/empty display patterns (positive cases)
import React from "react";

// NULL_COALESCE_FALLBACK -- nullish coalescing to a known placeholder string
function columnWithNullCoalesce(cell: { getValue: () => string | null }) {
  const value = cell.getValue();
  return value ?? "-";
}

// NULL_COALESCE_FALLBACK -- with N/A (wrong placeholder)
function columnWithNA(cell: { getValue: () => string | null }) {
  return cell.getValue() ?? "N/A";
}

// FALSY_COALESCE_FALLBACK -- falsy coalescing (catches 0 and "")
function columnWithFalsyCoalesce(getValue: () => string | null) {
  return getValue() || "-";
}

// NO_FALLBACK_CELL -- table cell with no null handling (columnHelper pattern)
const columnNoFallback = columnHelper.accessor("status", {
  cell: ({ getValue }) => getValue(),
});

// HARDCODED_PLACEHOLDER -- using '-' literal instead of NO_VALUE_PLACEHOLDER constant
function columnWithHardcodedDash(value: number | null) {
  if (!value) return "-";
  return String(value);
}

// HARDCODED_PLACEHOLDER -- using '-' in ternary
function metricWithDash(data: { count: number } | null) {
  const displayValue = data ? String(data.count) : "-";
  return displayValue;
}

// EMPTY_STATE_MESSAGE -- wrong empty state message
function tableEmptyState() {
  return <div>No data available</div>;
}

// EMPTY_STATE_MESSAGE -- canonical empty message (should still be observed, just not a violation)
function tableEmptyStateCorrect() {
  return <div>There is no data</div>;
}

// ZERO_CONFLATION -- !value conflates 0 with null, return value "0.00" is a numeric string (numeric proof)
function formatWithZeroConflation(value: number | null) {
  if (!value) return "0.00";
  return String(value);
}

// ZERO_CONFLATION -- ternary that treats 0 as falsy, truthy branch calls formatDuration (numeric proof)
function cellWithZeroConflation(getValue: () => number | null) {
  const val = getValue();
  return val ? formatDuration(val) : "-";
}

declare function formatDuration(v: number): string;
declare const columnHelper: {
  accessor: (key: string, opts: { cell: (info: { getValue: () => unknown }) => unknown }) => unknown;
  display: (opts: { cell: (info: { getValue: () => unknown }) => unknown }) => unknown;
};

export {
  columnWithNullCoalesce,
  columnWithNA,
  columnWithFalsyCoalesce,
  columnWithHardcodedDash,
  metricWithDash,
  tableEmptyState,
  tableEmptyStateCorrect,
  formatWithZeroConflation,
  cellWithZeroConflation,
};
