/* eslint-disable */
// Fixture: null/empty display patterns (negative cases)
import React from "react";
import { NO_VALUE_PLACEHOLDER } from "@/shared/constants";

// Using the constant -- NOT a HARDCODED_PLACEHOLDER
function columnWithConstant(value: string | null) {
  return value ?? NO_VALUE_PLACEHOLDER;
}

// ?? used for non-display purpose (default value computation)
function computeWithDefault(input: number | null) {
  const count = input ?? 0;
  return count * 2;
}

// || used for non-display purpose (boolean logic)
function checkPermission(isAdmin: boolean, isModerator: boolean) {
  return isAdmin || isModerator;
}

// !value guard followed by early return with the constant
function guardWithConstant(value: number | null) {
  if (!value) return NO_VALUE_PLACEHOLDER;
  return String(value);
}

// Empty string in non-display context (CSS class computation)
function getClassName(active: boolean) {
  return active ? "active" : "";
}

// ?? '' (empty string for CSS) -- should NOT produce NULL_COALESCE_FALLBACK
function cssClassName(value: string | undefined) {
  return value ?? "";
}

// ?? '/' (URL fallback) -- should NOT produce NULL_COALESCE_FALLBACK
function urlFallback(path: string | undefined) {
  return path ?? "/";
}

// ?? someVariable (non-literal) -- should NOT produce any observation
function dynamicFallback(value: string | undefined, fallback: string) {
  return value ?? fallback;
}

export {
  columnWithConstant,
  computeWithDefault,
  checkPermission,
  guardWithConstant,
  getClassName,
  cssClassName,
  urlFallback,
  dynamicFallback,
};
