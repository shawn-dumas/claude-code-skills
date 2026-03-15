# AST Observation Signals

Reference for what `ast-pw-test-parity.ts` (the observation layer) extracts
from Playwright spec files and helper files. All values are from the source
code and should be updated if the code changes.

## Extracted signals

### 1. Assertions

Detection: `expect(...).toXxx()` chains where the method name starts with `to`.

Resolves the full chain via `findExpectInChain()` to locate the root
`expect()` call. Records the matcher name and the first argument text.
Deduplicated by source line (one assertion per line).

Chain modifiers (`resolves`, `rejects`, `not`) are traversed but not
counted as assertions.

**Counts toward weight:** 1 per assertion.

### 2. Route intercepts

Detection: `page.route(urlPattern, ...)` or `context.route(urlPattern, ...)`.

Only recognized page objects are matched (configured in
`astConfig.testParity.pageObjects` -- currently `page` and `context`).

URL pattern is extracted from the first argument. Accepts string literals,
regex literals, or truncated expression text.

**Counts toward weight:** 2 per route intercept.

### 3. Navigations

Detection: `page.goto(url)` or `context.goto(url)`.

Same page object recognition as route intercepts. URL is extracted from
the first argument (string literal value or truncated expression).

**Counts toward weight:** 1 per navigation.

### 4. POM usage

Detection: `new XxxPage(...)` where the class name ends with the configured
`pomSuffix` (currently `Page`).

Stored as a deduplicated set of class names per test.

**Counts toward weight:** 1 per POM class used.

### 5. Helper delegations

Detection (two forms):

- **Standalone function calls:** Any identifier call not in `BUILTIN_CALL_NAMES`
  and not `expect`/`test`/`it`/`describe`.
- **POM method calls:** `object.method()` where `object` is not a page object,
  not `expect`, not `route`, not `console`.

Qualified name format: standalone functions use their name directly; POM
methods use `ClassName.methodName`.

Deduplicated by function name within each test block.

**Counts toward weight:** Resolved from helper index if available
(`max(helperIndex.lookup[name], 1)`), otherwise flat weight of 3.

### 6. File-level metadata (not used in weight)

| Signal       | Detection                                                     |
| ------------ | ------------------------------------------------------------- |
| `authMethod` | First match of `signInWithEmulator`, `signInAsONELOGINAdmin`, `signInAsMember`, `signIn` in file text |
| `serialMode` | File contains `"mode: 'serial'"`                              |
| `beforeEach` | File contains `'beforeEach'`                                  |
| `describes`  | All `describe()` string literal arguments                     |

## NOT extracted

The following Playwright API calls produce zero signal and zero weight:

| Category          | Examples                                                              |
| ----------------- | --------------------------------------------------------------------- |
| Locator calls     | `getByRole()`, `getByTestId()`, `getByText()`, `locator()`, `first()`, `nth()` |
| Actions           | `click()`, `fill()`, `type()`, `press()`, `clear()`, `check()`, `selectOption()` |
| Wait calls        | `waitFor()`, `waitForSelector()`, `waitForURL()`, `waitForLoadState()`, `waitForTimeout()`, `waitForFunction()`, `waitForResponse()` |
| Page evaluation   | `page.evaluate()`                                                     |
| Screenshots       | `screenshot()`, `toHaveScreenshot()`                                  |
| `beforeAll`       | Only `beforeEach` is detected                                         |
| Chain modifiers   | `not`, `resolves`, `rejects` (traversed, not counted)                 |

### Why this matters

A test that hides all its navigation and assertions inside opaque utility
functions (like the QA specs do with `signInAsONELOGINAdmin(page)` and
`verifyInsightsPage(page, role)`) will produce nearly zero extractable
signals. The observation layer cannot see inside opaque function calls --
it records the function name as a helper delegation.

However, the **interpreter** resolves helper delegations against a helper
index built from POM/utility files. `resolveHelperWeight` uses fuzzy class
matching to bridge variable names (`insights.verifyExport`) to class names
(`InsightsPage.verifyExport`), recovering actual assertion counts. The
assertion equivalence floor then prevents false REDUCED classifications
when resolved assertions are sufficient.

This means:
- Source tests using opaque helpers have low observation-layer weights
- The interpreter resolves helper weights via the helper index, recovering
  actual assertion counts for both source and target helpers
- When the target uses a mock handler baseline, route intercept weight
  differential is normalized to prevent false REDUCED
- The weight ratio can still be skewed when helpers are not indexed (e.g.,
  helpers in directories not listed in `helperDirs` config)

When creating fixtures, match the structural patterns of the real specs.
Do not inline assertions that the real code hides in helpers.

## BUILTIN_CALL_NAMES (excluded from helper delegation)

```
expect, require, console, setTimeout, setInterval, clearTimeout,
clearInterval, Promise, Array, Object, JSON, String, Number, Date,
Math, parseInt, parseFloat
```

## Helper file analysis

`analyzeHelperFile()` walks helper/POM files looking for:

1. **Class methods** (`MethodDeclaration`) -- qualified as `ClassName.methodName`
2. **Function declarations** -- qualified as the function name
3. **Arrow/function-expression variable declarations** -- qualified as the variable name

For each, it counts `expect().toXxx()` assertions inside the node body
(same detection logic, deduplicated by line).

The helper index maps `qualifiedName --> assertionCount` for weight
resolution during interpretation.

## Cross-file factory detection

When a spec file has zero top-level tests after direct and in-file factory
expansion, the tool attempts cross-file resolution:

1. Find relative imports (`./` or `../` paths)
2. Resolve import paths (tries `.ts`, `.tsx`, `/index.ts`)
3. Find call sites of imported functions in the spec
4. Extract the first argument (expected object literal) and build a `paramMap`
5. Parse the factory file and find the matching exported function
6. Resolve template literal test names by substituting `paramMap` values
7. Extract body signals from each test inside the factory

**Requirement:** The factory file must exist on disk at the resolved import
path. This means the fixture test must write helper files to the temp
directory before analyzing target specs. See `ast-fixture-authoring.md`.

## In-file factory detection

Detects function declarations or arrow-function variables that contain
`test()` / `it()` calls with template-expression names. Finds all call
sites, resolves the interpolated parameter from the call argument, and
creates one `PwTestBlock` per invocation with the resolved name.
