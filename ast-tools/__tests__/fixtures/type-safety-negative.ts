/* eslint-disable */
// Fixture file for ast-type-safety NEGATIVE tests.
// Tests behavior for patterns that should NOT be flagged as violations,
// or should have specific evidence fields set.

// 1. `as const` should NOT be flagged
const ROLES_NEG = ['admin', 'user'] as const;

// 2. `as any` inside a conditional type (legitimate type programming)
// Should have isInsideComplexType: true in the observation
type IsString<T> = T extends string ? T : any;
type ConditionalWithAny = any extends string ? true : false;

// 3. Non-null assertion with a preceding guard (hasGuard: true, guardType: 'has-check')
const mapNeg = new Map<string, number>();
if (mapNeg.has('key')) {
  const val = mapNeg.get('key')!;
}

// 4. Non-null assertion WITHOUT a guard (hasGuard: false)
const maybeNull: string | null = null;
const forced = maybeNull!;

// 5. Non-null assertion with null-check if guard (hasGuard: true, guardType: 'null-check' or 'if-check')
function nullCheckGuard(x: string | null): string {
  if (x !== null) {
    return x!;
  }
  return '';
}

// 6. Trust boundary cast that is NOT guarded -- SHOULD be TRUST_BOUNDARY_CAST
// Should have trustBoundarySource: 'JSON.parse'
interface ConfigNeg {
  host: string;
}
const rawInput = '{}';
const unsafeData = JSON.parse(rawInput) as ConfigNeg;

// 7. ts-expect-error directives (both with and without explanations)
// Note: These are for testing directive detection, they must have valid uses
function forceError(): number {
  // @ts-expect-error -- deliberate type error for testing
  return 'not a number';
}

function forceError2(): number {
  // @ts-expect-error
  return 'also not a number';
}

// 9. eslint-disable with explanation (hasExplanation: true)
// eslint-disable-next-line no-console -- needed for debugging
console.log('test');

// 10. eslint-disable without explanation (hasExplanation: false)
// eslint-disable-next-line no-console
console.log('test2');

// 11. Trust boundary: localStorage.getItem cast (trustBoundarySource: 'localStorage')
const localData = localStorage.getItem('key') as string;

// 12. Trust boundary: sessionStorage.getItem cast (trustBoundarySource: 'sessionStorage')
const sessionData = sessionStorage.getItem('key') as string;

// 13. satisfies should NOT be flagged at all
interface ThemeNeg {
  color: string;
}
const themeNeg = { color: 'red' } satisfies ThemeNeg;

// 14. Mapped type with any (isInsideComplexType: true)
type Partial2<T> = {
  [K in keyof T]?: T[K] extends object ? any : T[K];
};

// 15. Template literal type (isInsideComplexType: true)
type EventName<T extends string> = `${T}Event` extends any ? T : never;
