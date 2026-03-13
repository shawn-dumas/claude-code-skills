/* eslint-disable */
// Negative fixture file for ast-storage-access tests.
// Contains patterns that should NOT be flagged as storage access, or edge cases.

// 1. Variable named 'localStorage' (shadows global)
const localStorage = { getItem: (k: string) => k };
localStorage.getItem('test'); // Should still be DIRECT_STORAGE_CALL (tool does not track shadowing)

// 2. Wrapper function that calls localStorage internally
function getFromCache(key: string) {
  return window.localStorage.getItem(key);
}
getFromCache('token'); // Caller is NOT a direct storage call (not detected)

// 3. readStorage called on an unrelated object (not typedStorage)
const store = { readStorage: () => null };
store.readStorage(); // Should NOT be TYPED_STORAGE_CALL (method call on object, not bare function)

// 4. JSON.parse on non-storage data
const config = JSON.parse('{"key": "value"}'); // IS JSON_PARSE_CALL (still flagged)

// 5. sessionStorage.length (property access, not method call)
const len = sessionStorage.length; // Should be STORAGE_PROPERTY_ACCESS

// 6. Non-standard localStorage method (should still be flagged)
function customStorageAccess() {
  const keys = localStorage.key(0); // Should be STORAGE_PROPERTY_ACCESS (not a standard method)
  return keys;
}

// 7. Cookies object that is not js-cookie
const MyCookies = { get: (k: string) => k };
MyCookies.get('token'); // Should NOT be COOKIE_CALL (object is MyCookies, not Cookies)

// 8. JSON.parse with Zod parse on same line (should be guarded)
function zodGuardedParse() {
  const result = schema.parse(JSON.parse('{}'));
  return result;
}

// 9. JSON.parse with Zod safeParse (should be guarded)
function zodSafeParseGuarded() {
  const result = schema.safeParse(JSON.parse('{}'));
  return result;
}

// --- Dummy declarations to prevent unresolved reference errors ---
declare const window: { localStorage: Storage };
declare const sessionStorage: Storage;
declare const schema: { parse: (v: unknown) => unknown; safeParse: (v: unknown) => unknown };
