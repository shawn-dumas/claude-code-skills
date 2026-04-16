/* eslint-disable */
// Fixture file for ast-env-access tests. Contains intentional env access patterns.

// --- CLIENT_ENV_IMPORT ---
import { clientEnv } from '@/shared/lib/env/clientEnv';

// --- SERVER_ENV_IMPORT ---
import { serverEnv } from '@/shared/lib/env/serverEnv';

// --- CLIENT_ENV_ACCESS (compliant) ---
const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

function getBaseUrl() {
  return clientEnv.NEXT_PUBLIC_BASE_URL;
}

// --- SERVER_ENV_ACCESS (compliant) ---
function getDatabaseUrl() {
  return serverEnv.DATABASE_URL;
}

const secret = serverEnv.AUTH_SECRET;

// --- DIRECT_PROCESS_ENV (violation) ---
const badAccess = process.env.SOME_VAR;

function readEnvDirectly() {
  return process.env.DATABASE_URL;
}

// --- DIRECT_PROCESS_ENV with tree-shaking guard ---
// eslint-disable-next-line local/no-process-env -- build-time tree-shaking guard
const isProduction = process.env.NEXT_PUBLIC_ENVIRONMENT === 'production';

// Another tree-shaking guard pattern
// tree-shaking: Next.js inlines this at build time
const isMocked = process.env.NEXT_PUBLIC_ENVIRONMENT === 'mocked';

// --- RAW_ENV_IMPORT (violation) ---
const env = process.env;

// --- Nested arrow function with env access ---
const getConfig = () => {
  const host = clientEnv.NEXT_PUBLIC_HOST;
  return { host };
};
