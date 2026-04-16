/* eslint-disable */
// Fixture: number formatting patterns (positive cases)
// Each section exercises one observation kind

import { formatNumber } from "../../src/shared/utils/number/formatNumber/formatNumber";
import { formatInt } from "../../src/shared/utils/number/formatInt/formatInt";
import { formatDuration } from "../../src/shared/utils/time/formatDuration/formatDuration";
import { formatCellValue } from "../../src/shared/utils/table/formatCellValue/formatCellValue";
import { UnitsType } from "../../src/ui/types";

// FORMAT_NUMBER_CALL
function exampleFormatNumber(value: number) {
  const a = formatNumber(value);
  const b = formatNumber(value, 1);
  return [a, b];
}

// FORMAT_INT_CALL
function exampleFormatInt(value: number) {
  return formatInt(value);
}

// FORMAT_DURATION_CALL
function exampleFormatDuration(seconds: number) {
  return formatDuration(seconds);
}

// FORMAT_CELL_VALUE_CALL
function exampleFormatCellValue(value: number) {
  const a = formatCellValue(value, UnitsType.PERCENTAGE);
  const b = formatCellValue(value, UnitsType.TIME, true);
  return [a, b];
}

// RAW_TO_FIXED -- should be flagged
function exampleRawToFixed(num: number) {
  return num.toFixed(2);
}

// RAW_TO_LOCALE_STRING -- should be flagged
function exampleRawToLocaleString(num: number) {
  return num.toLocaleString("en-US");
}

// PERCENTAGE_DISPLAY -- detect percentage-related formatting
// Case 1: toFixed inside template literal with %
function examplePercentageDisplay(percentage: number) {
  return `${percentage.toFixed(2)}%`;
}

// PERCENTAGE_DISPLAY -- Case 2: Math.round inside template literal with %
function examplePercentageDisplayRound(percentage: number) {
  return `${Math.round(percentage)}%`;
}

// INTL_NUMBER_FORMAT
function exampleIntlFormat(value: number) {
  const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  return fmt.format(value);
}

export {
  exampleFormatNumber,
  exampleFormatInt,
  exampleFormatDuration,
  exampleFormatCellValue,
  exampleRawToFixed,
  exampleRawToLocaleString,
  examplePercentageDisplay,
  examplePercentageDisplayRound,
  exampleIntlFormat,
};
