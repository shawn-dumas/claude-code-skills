/* eslint-disable */
// Fixture: component returning a top-level && guard (not nested inside a JSX element).
// This exercises the isInsideJsxAttribute path that walks all the way to the top
// without finding a JsxAttribute or JSX container, returning false at line 115.

export function TopLevelGuard({ show }: { show: boolean }) {
  return show && <div>hello</div>;
}
