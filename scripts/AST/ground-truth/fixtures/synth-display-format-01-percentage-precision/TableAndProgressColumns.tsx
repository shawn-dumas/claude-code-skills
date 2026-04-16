import React from "react";

// Table cell should use 2 decimal precision but uses 1
function tablePercentage(value: number) {
  // Wrong: table context expects 2 decimals
  return `${value.toFixed(1)}%`;
}

// Progress bar should use 1 decimal but uses 2
function progressPercentage(value: number) {
  // Wrong: progress bar context expects 1 decimal
  return `${value.toFixed(2)}%`;
}

// Correct: stacked bar uses 0 decimals
function stackedBarPercentage(value: number) {
  return `${Math.round(value)}%`;
}

export { tablePercentage, progressPercentage, stackedBarPercentage };
