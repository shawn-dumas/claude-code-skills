// Wrong: uses toFixed directly for display
function rawToFixed(value: number): string {
  return value.toFixed(2);
}

// Wrong: uses toLocaleString directly
function rawLocaleString(value: number): string {
  return value.toLocaleString("en-US");
}

// Correct: uses shared formatter
import { formatNumber } from "../../shared/utils/number/formatNumber/formatNumber";
function correctFormatter(value: number): string {
  return formatNumber(value, 2);
}

export { rawToFixed, rawLocaleString, correctFormatter };
