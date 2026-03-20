import { formatDuration } from "../../shared/utils/time/formatDuration/formatDuration";

// Wrong: || hides zero values for a numeric column
function falsyCoalesceNumeric() {
  return getValue() || "-";
}

// Correct: ?? only catches null/undefined
function nullishCoalesce() {
  return getValue() ?? "-";
}

// Wrong: !value catches 0
function zeroConflation(value: unknown) {
  if (!value) return "0.00";
  return formatDuration(Number(value));
}

// Correct: explicit null check
function explicitNullCheck(value: number | null) {
  if (value == null) return "-";
  return formatDuration(value);
}

export {
  falsyCoalesceNumeric,
  nullishCoalesce,
  zeroConflation,
  explicitNullCheck,
};
