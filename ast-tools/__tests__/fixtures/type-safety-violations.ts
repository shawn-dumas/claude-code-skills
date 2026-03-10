/* eslint-disable */
// Fixture file for ast-type-safety tests. Contains intentional violations.

// --- AS_ANY ---
const unsafeValue = null as unknown as any;
const anotherUnsafe = 'hello' as any;

// --- AS_UNKNOWN_AS (double cast) ---
interface Bar {
  x: number;
}
const doubleCast = 'hello' as unknown as Bar;

// --- NON_NULL_ASSERTION (unguarded) ---
const map = new Map<string, number>();
const ungarded = map.get('key')!;

// --- NON_NULL_ASSERTION (guarded) ---
if (map.has('key')) {
  const guarded = map.get('key')!;
}

// --- EXPLICIT_ANY_ANNOTATION ---
function takesAny(x: any): void {
  console.log(x);
}

// --- Record<string, any> ---
const record: Record<string, any> = {};

// --- CATCH_ERROR_ANY ---
try {
  throw new Error('test');
} catch (error: any) {
  console.log(error);
}

// --- @ts-expect-error without comment ---
// @ts-expect-error
const tsError = 1 + '2';

// --- @ts-expect-error WITH comment (should NOT be flagged) ---
// @ts-expect-error -- testing type coercion
const tsErrorOk = 1 + '2';

// --- Trust boundary cast ---
interface Config {
  host: string;
}
const parsed = JSON.parse('{}') as Config;

// --- as const (should NOT be flagged) ---
const STATUS = {
  active: 'active',
  inactive: 'inactive',
} as const;

// --- satisfies (should NOT be flagged) ---
interface Theme {
  color: string;
}
const theme = { color: 'red' } satisfies Theme;

// --- eslint-disable without comment ---
// eslint-disable-next-line no-console
console.log('test');

// --- eslint-disable WITH comment (should NOT be flagged) ---
// eslint-disable-next-line no-console -- needed for debugging
console.log('test2');

// --- Complex conditional type with any (should NOT be flagged) ---
type IsAny<T> = 0 extends 1 & T ? true : false;
type ConditionalAny = any extends string ? true : false;

// --- Array<any> ---
const arr: Array<any> = [];
