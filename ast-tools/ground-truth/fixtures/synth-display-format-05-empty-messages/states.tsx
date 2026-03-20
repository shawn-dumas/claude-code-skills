import React from "react";

// Wrong empty message
function wrongEmptyMessage() {
  return <div>No data available</div>;
}

// Correct empty message (should NOT be flagged)
function correctEmptyMessage() {
  return <div>There is no data</div>;
}

// No fallback on cell value -- columnHelper pattern required for NO_FALLBACK_CELL detection
declare const columnHelper: {
  accessor: (key: string, opts: unknown) => unknown;
};
const noFallbackCell = columnHelper.accessor("status", {
  cell: ({ getValue }: { getValue: () => string | null }) => getValue(),
});

export { wrongEmptyMessage, correctEmptyMessage, noFallbackCell };
