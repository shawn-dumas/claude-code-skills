/* eslint-disable */
// Negative fixture file for ast-env-access tests.
// Contains patterns that should NOT be flagged, or edge cases.

// 1. Variable named 'process' (shadows global)
const process = { env: { NODE_ENV: 'test' } };
process.env.NODE_ENV; // Still detected -- tool does not track shadowing

// 2. Indirect env access through a function
function getEnv(key: string) {
  return (globalProcess as ProcessType).env[key];
}
getEnv('API_URL'); // Caller is NOT a direct env access

// 3. Import of a module that happens to have 'env' in path but is not clientEnv/serverEnv
import { something } from './environments/config';

// 4. Tree-shaking guard with eslint-disable comment
// eslint-disable-next-line local/no-process-env -- tree-shaking guard
if (process.env.NEXT_PUBLIC_GUARD_TEST === 'local') {
  // This SHOULD have hasTreeShakingComment: true
}

// 5. Another tree-shaking pattern
// tree-shaking: Next.js inlines this at build time
const isMocked = process.env.NEXT_PUBLIC_MOCKED_TEST === 'mocked';

// 6. Object with clientEnv-like name but not the actual wrapper
const myClientEnv = { NEXT_PUBLIC_API_URL: 'http://localhost' };
myClientEnv.NEXT_PUBLIC_API_URL; // Should NOT be ENV_WRAPPER_ACCESS

// 7. Accessing env property without process prefix
const envVar = envObject.SOME_VAR; // Should NOT be flagged

// 8. Dynamic property access on process.env (not detected as DIRECT_PROCESS_ENV)
function getDynamicEnv(key: string) {
  return globalProcess.env[key]; // Only process.env.PROPERTY is detected
}

// --- Dummy declarations to prevent unresolved reference errors ---
declare const globalProcess: ProcessType;
interface ProcessType {
  env: Record<string, string | undefined>;
}
declare const something: unknown;
declare const envObject: Record<string, string>;
