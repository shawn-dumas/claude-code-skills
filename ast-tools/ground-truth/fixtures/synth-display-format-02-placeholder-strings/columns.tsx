import React from "react";

// Wrong: uses N/A
function naPlaceholder() {
  return cell.getValue() ?? "N/A";
}

// Wrong: uses double dash
function doubleDash() {
  return cell.getValue() ?? "--";
}

// Wrong: hardcoded '-' literal without constant import
function hardcodedDash() {
  return cell.getValue() ?? "-";
}

export { naPlaceholder, doubleDash, hardcodedDash };
