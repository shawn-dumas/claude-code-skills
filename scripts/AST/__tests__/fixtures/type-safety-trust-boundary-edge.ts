/* eslint-disable */
// Fixture for edge cases in getTrustBoundarySource and detectGuardType:
//   1. process.env property access trust boundary (lines 503-506)
//   2. readStorage() trust boundary with unknown source (line 529)
//   3. as unknown as with inline block comment justification (line 554)
//   4. await response.json() trust boundary (line 500)
//   5. Non-null assertion inside a function body with non-guard preceding statement (line 489)

interface DbConfig {
  host: string;
  port: number;
}

// 1. process.env trust boundary -- exercises lines 503-505 in getTrustBoundarySource
//    process.env.DATABASE_URL is a PropertyAccessExpression starting with 'process.env.'
const dbUrl = process.env.DATABASE_URL as string;

// 2. readStorage() trust boundary -- exercises line 529 in getTrustBoundarySource
//    readStorage is in trustBoundaryCalls but has no named source in getTrustBoundarySource
declare function readStorage(key: string): unknown;
const stored = readStorage('config') as DbConfig;

// 3. as unknown as with inline block comment -- exercises line 554 in hasPrecedingComment
//    The cast line itself has a trailing /* ... */ comment after the cast
const x: unknown = {};
const typed = x as unknown as DbConfig; /* justified: external data shape guaranteed by API contract */

// 4. await response.json() as T -- exercises line 500 (AwaitExpression path in getTrustBoundarySource)
declare function fetchConfig(): Promise<Response>;
async function loadConfig(): Promise<DbConfig> {
  const response = await fetchConfig();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (await response.json()) as DbConfig;
}

// 5. Non-null assertion with non-guard preceding statement in function body
//    This exercises line 489 (return { hasGuard: false } after loop finds no guard)
function useWithNonGuardPreceding(val: string | null): string {
  const prepared = 'preprocessing';
  return val!;
}

// 6. Non-null assertion preceded by an if-statement that does NOT match the null-guard pattern
//    This exercises lines 482-484 (Node.isIfStatement branch in detectGuardType loop)
//    The if-condition is unrelated to `val`, so matchesNullGuard returns false.
declare const someCondition: boolean;
function useWithUnrelatedIfStatement(val: string | null): string {
  if (someCondition) {
    void 0;
  }
  return val!;
}

// 6. Non-null assertion preceded by an if-statement that does NOT match the null-guard pattern
//    This exercises lines 481-483 (Node.isIfStatement branch in detectGuardType loop)
//    The if-condition is unrelated to `val`, so matchesNullGuard returns false.
declare const someCondition: boolean;
function useWithUnrelatedIfStatement(val: string | null): string {
  if (someCondition) {
    void 0;
  }
  return val!;
}

// 7. Non-null assertion as FIRST statement in block (nodeStmtIndex <= 0 path, line 472)
function useAsFirstStatement(val: string | null): string {
  return val!;
}

// 8. Non-null assertion preceded by a matching has-guard STATEMENT (not ancestor) -- line 479
//    matchesHasGuard sees 'm.has(...)' before 'm.get(...)!'
function useWithHasGuardStatement(m: Map<string, string>): string {
  m.has('key');
  return m.get('key')!;
}

// 9. Non-null assertion preceded by a null-check if-statement (same block) -- line 484
//    The if-condition IS `val !== null`, so matchesNullGuard returns true -> guardType: 'null-check'
function useWithNullCheckIfStatement(val: string | null, other: string | null): string {
  if (val !== null) {
    void 0;
  }
  return val!;
}

// 10. Property access cast that is NOT a trust boundary (exercises line 109 in isTrustBoundaryExpression)
//     someObj.prop is a PropertyAccessExpression that does NOT start with 'process.env.'
//     isTrustBoundaryCall returns false (not a CallExpression), PropertyAccess check fails,
//     so isTrustBoundaryExpression falls through to `return false` at line 109.
declare const someObj: { prop: unknown };
const notTrustBoundary = someObj.prop as string;

// 11. Method call with non-trust-boundary method name (exercises matchesPropertyAccessPattern
//     return false at line 73)
//     'someService.getData()' triggers matchesPropertyAccessPattern but no pattern matches.
declare const someService: { getData: () => unknown };
const nonMatchingMethod = someService.getData() as string;
