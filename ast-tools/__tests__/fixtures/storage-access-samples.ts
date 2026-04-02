/* eslint-disable */
// Fixture file for ast-storage-access tests. Contains intentional storage access patterns.

// --- DIRECT_LOCAL_STORAGE ---
function directLocalStorageGetItem() {
  const val = localStorage.getItem('key');
  return val;
}

function directLocalStorageSetItem() {
  localStorage.setItem('key', 'value');
}

function directLocalStorageRemoveItem() {
  localStorage.removeItem('key');
}

function directLocalStorageClear() {
  localStorage.clear();
}

// --- DIRECT_SESSION_STORAGE ---
function directSessionStorageGetItem() {
  const val = sessionStorage.getItem('token');
  return val;
}

function directSessionStorageSetItem() {
  sessionStorage.setItem('token', 'abc');
}

// --- TYPED_STORAGE_READ (compliant) ---
function compliantRead() {
  const result = readStorage('key', someSchema);
  return result;
}

// --- TYPED_STORAGE_WRITE (compliant) ---
function compliantWrite() {
  writeStorage('key', { value: 42 });
}

// --- TYPED_STORAGE_REMOVE (compliant) ---
function compliantRemove() {
  removeStorage('key');
}

// --- JSON_PARSE_UNVALIDATED ---
function jsonParseUnvalidated() {
  const data = JSON.parse('{"x": 1}');
  return data;
}

function jsonParseAssignedThenUsed() {
  const raw = JSON.parse(someString);
  doSomething(raw);
}

// --- JSON.parse with Zod validation (should NOT be flagged) ---
function jsonParseWithZodParse() {
  const data = someSchema.parse(JSON.parse('{"x": 1}'));
  return data;
}

function jsonParseWithZodSafeParse() {
  const result = someSchema.safeParse(JSON.parse('{}'));
  return result;
}

// --- COOKIE_ACCESS ---
function readDocumentCookie() {
  const c = document.cookie;
  return c;
}

function writeDocumentCookie() {
  document.cookie = 'name=value';
}

function jsCookieGet() {
  const val = Cookies.get('custom_token');
  return val;
}

function jsCookieSet() {
  Cookies.set('custom_token', 'abc123');
}

function jsCookieRemove() {
  Cookies.remove('custom_token');
}

// --- Pattern A: variable capture + later Zod call (should be JSON_PARSE_ZOD_GUARDED) ---
function zodGuardedViaConstCapture() {
  const raw = JSON.parse(someString);
  return someSchema.parse(raw);
}

function zodGuardedViaLetReassignment() {
  let raw: unknown;
  try {
    raw = JSON.parse(someString);
  } catch {
    raw = undefined;
  }
  return someSchema.safeParse(raw);
}

// --- Pattern B: inside z.preprocess callback (should be JSON_PARSE_ZOD_GUARDED) ---
const preprocessSchema = z.preprocess(data => {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data as string) as unknown;
  } catch {
    return data;
  }
}, someSchema);

// --- Pattern C: comment-based exemption (should be JSON_PARSE_ZOD_GUARDED) ---
function exemptViaComment() {
  // json-parse-exempt: infrastructure boundary, validated downstream
  const data = JSON.parse(someString);
  return data;
}

// --- Dummy declarations to prevent unresolved reference errors ---
declare const someSchema: { parse: (v: unknown) => unknown; safeParse: (v: unknown) => unknown };
declare const someString: string;
declare function doSomething(x: unknown): void;
declare function readStorage(key: string, schema: unknown): unknown;
declare function writeStorage(key: string, value: unknown): void;
declare function removeStorage(key: string): void;
declare const Cookies: { get: (k: string) => string; set: (k: string, v: string) => void; remove: (k: string) => void };
declare const z: { preprocess: (fn: (d: unknown) => unknown, schema: unknown) => unknown };
