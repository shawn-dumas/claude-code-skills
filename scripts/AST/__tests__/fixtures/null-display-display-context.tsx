/* eslint-disable */
// Fixture: isDisplayContext edge cases for HARDCODED_PLACEHOLDER detection,
// plus the info.getValue() pattern for isBareGetValueCall.
import React from 'react';

// VariableDeclaration parent (line 281): const x = '-'
function displayViaVariable() {
  const placeholder = '-';
  return <div>{placeholder}</div>;
}

// ArrowFunction parent (line 284): () => '-'
const getPlaceholder = () => '-';

// JsxExpression parent (line 290): {'-'} inside JSX
function DisplayJsx() {
  return <span>{'-'}</span>;
}

// NO_FALLBACK_CELL -- info.getValue() pattern (covers isBareGetValueCall line 345-346)
declare const columnHelper: {
  accessor: (key: string, opts: { cell: (info: { getValue: () => unknown }) => unknown }) => unknown;
  display: (opts: { cell: (info: { getValue: () => unknown }) => unknown }) => unknown;
};
const columnInfoGetValue = columnHelper.accessor('name', {
  cell: info => info.getValue(),
});

// columnHelper.display with a non-bare cell body (covers isBareGetValueCall line 349 -- returns false)
// The arrow body calls format(), not getValue(), so isBareGetValueCall returns false
declare function formatVal(v: unknown): string;
const columnWithFormat = columnHelper.display({
  cell: info => formatVal(info.getValue() as string),
});

// Dash in non-display context (object literal value) -- covers isDisplayContext line 292 (returns false)
const config = { placeholder: '-' };

export { displayViaVariable, getPlaceholder, DisplayJsx, columnInfoGetValue, columnWithFormat, config };
