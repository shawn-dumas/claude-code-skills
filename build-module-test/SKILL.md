---
name: build-module-test
description: Generate a test file for a non-React module (utility, server processor, API handler, data transformer). Reads the production API surface, selects the correct strategy, wires fixture data, and produces a spec that scores 10/10 on audit-module-test.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/production-file.ts>
---

Generate a test file for the production module at `$ARGUMENTS`.

## Step 0: Pre-flight -- delete-or-build decision

Check whether a spec file already exists for this production file. Look for
`<basename>.spec.ts`, `<basename>.test.ts` in the same directory and in sibling
`__tests__/` or `tests/` directories.

If a spec file exists, run the delete threshold check:

| Condition | Decision |
|-----------|----------|
| Production file was deleted or moved | Delete the spec (orphaned) |
| Spec scores <= 4/10 on the 10 principles (quick estimate) | Delete and rebuild |
| >= 3 own-module mocks (non-boundary `vi.mock` targets) | Delete and rebuild |
| >= 2 stale references (deleted functions, changed signatures) | Delete and rebuild |
| Spec is a copy-paste of another spec | Delete and rebuild |

If no spec exists or the old one was deleted, continue to generate fresh.

## Step 1: Read the production file

Read the target file completely. Record:

- **Exports**: Every named export (functions, types, constants, classes)
- **For each function**: Parameter types, return type, whether async, whether it
  throws. If the return type is not explicit, trace it from the implementation.
- **Side effects**: Does the function perform I/O? (fs, fetch, database, console,
  storage, env var reads, timers)
- **Dependencies**: What does this file import? Classify each:
  - Own project imports (other modules, types, utilities)
  - External library imports
  - Boundary imports (fs, fetch, database clients, process.env)

## Step 2: Classify and select strategy

| Classification | Criteria | Strategy |
|----------------|----------|----------|
| **Pure function** | No I/O, no side effects, deterministic | **Zero mocks** -- call function, assert return value |
| **I/O function** | Reads/writes filesystem, network, database, storage | **Boundary mocks** -- mock only the I/O boundary |
| **Mixed module** | Some pure exports, some I/O exports | **Split** -- pure tests (no mocks) + I/O tests (boundary mocks) in separate describe blocks |
| **Data transformer** | Takes data in, returns transformed data out. May be complex but is pure | **Zero mocks** -- construct input data, assert output shape |
| **API handler** | Next.js request handler | **Boundary mocks** (fetch/DB) + mock req/res objects |

## Step 3: Survey surrounding conventions

Read 1-2 existing spec files near the target (if any exist) to match:

- Import style (relative vs alias paths)
- `describe`/`it` vs `describe`/`test` (this codebase uses `it`)
- Assertion style
- File naming convention

Also check the global test setup:
- `vitest.setup.ts` provides global `afterEach(() => vi.clearAllMocks())`
  and `afterAll(() => { fetchMocker.disableMocks(); vi.useRealTimers(); })`
- `fetchMock` is globally available (from `vitest-fetch-mock`)
- Vitest globals are auto-imported (`describe`, `it`, `expect`, `vi`, etc.)

## Step 4: Design the test plan

### For pure functions / data transformers

For each exported function:
- **Typical inputs**: At least one test with realistic data that exercises the
  main code path
- **Edge cases**: Empty inputs, null/undefined (if accepted), boundary values,
  single-element collections, maximum-size inputs
- **Error cases**: Invalid inputs that should throw or return error values
- **Output shape**: Verify the return value matches the declared type -- all
  required fields present, correct types

For data transformers with complex output:
- Test sub-properties individually rather than deep-equal on the entire object
- Focus on the transformation logic: "given this input shape, these output fields
  should have these values"

### For I/O functions

- **Success path**: Mock the I/O boundary to return valid data, assert the function
  transforms and returns it correctly
- **Error path**: Mock the I/O boundary to throw/reject, assert the function
  propagates or handles the error correctly
- **Boundary verification**: Assert the I/O boundary was called with correct
  arguments (URL, path, query, etc.)

### For mixed modules

- Pure functions: test with zero mocks in their own `describe` block
- I/O functions: test with boundary mocks in a separate `describe` block
- Never mix mocked and unmocked tests in the same `describe`

## Step 5: Check for fixture builders

Before writing inline test data, check `src/fixtures/domains/` for existing
builders that produce the types needed.

```
# For a function that takes CompanySpan[]:
# Check if systemsFixtures.build() or similar exists
Grep for the type name in src/fixtures/domains/
```

Use fixture builders when they exist. They produce complete, type-safe objects
and keep test data in sync with production types.

If no fixture exists, use inline data with explicit type annotations.

## Step 6: Generate the spec file

Create `<target-dir>/<ModuleName>.spec.ts`.

### Pure function template

```typescript
import { myFunction, myOtherFunction } from './myModule';

// ── Test data ──────────────────────────────────────────────────────────

const validInput = { /* realistic test data with explicit types */ };
const emptyInput = { /* minimal/empty variant */ };

// ── Tests ──────────────────────────────────────────────────────────────

describe('myFunction', () => {
  it('returns expected output for typical input', () => {
    const result = myFunction(validInput);
    expect(result.fieldA).toBe('expected');
    expect(result.items).toHaveLength(3);
  });

  it('handles empty input', () => {
    const result = myFunction(emptyInput);
    expect(result.items).toEqual([]);
  });

  it('throws on invalid input', () => {
    expect(() => myFunction(null as never)).toThrow();
  });
});

describe('myOtherFunction', () => {
  // ...
});
```

### I/O function template

```typescript
import { readAndProcess } from './myModule';

// ── Mocks (boundary only) ──────────────────────────────────────────────

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

import { readFile, writeFile } from 'fs/promises';

// ── Test data ──────────────────────────────────────────────────────────

const validFileContent = JSON.stringify({ /* ... */ });

// ── Tests ──────────────────────────────────────────────────────────────

describe('readAndProcess', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
    vi.mocked(writeFile).mockReset();
  });

  it('reads file and returns processed data', async () => {
    vi.mocked(readFile).mockResolvedValue(validFileContent);

    const result = await readAndProcess('/some/path.json');

    expect(readFile).toHaveBeenCalledWith('/some/path.json', 'utf-8');
    expect(result.items).toHaveLength(3);
  });

  it('propagates read errors', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    await expect(readAndProcess('/missing.json')).rejects.toThrow('ENOENT');
  });
});
```

### Data transformer template (large input/output)

```typescript
import { buildSystemsOverviewFast } from './systemsSpans';
import { systemsFixtures } from '@/fixtures';

// ── Test data ──────────────────────────────────────────────────────────

const spans = systemsFixtures.buildSpans(10);
const summary = systemsFixtures.buildSummary();

// ── Tests ──────────────────────────────────────────────────────────────

describe('buildSystemsOverviewFast', () => {
  it('aggregates spans into system-level overview', () => {
    const result = buildSystemsOverviewFast(spans, summary);

    expect(result.systemsData).toBeDefined();
    expect(result.systemsData.length).toBeGreaterThan(0);
    expect(result.kpiSummary.totalSpans).toBe(spans.length);
  });

  it('handles empty span array', () => {
    const result = buildSystemsOverviewFast([], summary);

    expect(result.systemsData).toEqual([]);
    expect(result.kpiSummary.totalSpans).toBe(0);
  });

  it('groups spans by system name', () => {
    const twoSystems = [
      systemsFixtures.buildSpan({ system: 'Jira' }),
      systemsFixtures.buildSpan({ system: 'Jira' }),
      systemsFixtures.buildSpan({ system: 'Confluence' }),
    ];

    const result = buildSystemsOverviewFast(twoSystems, summary);

    const systemNames = result.systemsData.map(s => s.name);
    expect(systemNames).toContain('Jira');
    expect(systemNames).toContain('Confluence');
  });
});
```

### Rules (the 10 principles, enforced during generation)

**P1 -- Public API Only:**
- Assert on return values, resolved values, thrown errors
- Never assert on internal helper call counts or internal state
- Never spy on unexported functions

**P2 -- Boundary Mocking:**
- Mock ONLY I/O boundaries: `fs`, `fetch`/`fetchApi`, database clients,
  `process.env`, `localStorage`, `crypto`
- NEVER mock own pure functions, own utilities, or own internal helpers
- Third-party library mocks are acceptable if the library performs I/O

**P3 -- System Isolation:**
- Let real internal functions run
- Do not mock modules from the same codebase unless they perform I/O

**P4 -- Strict Strategies:**
- Pure function tests: zero `vi.mock()` calls
- I/O function tests: mock only the I/O boundary
- Never mix: pure tests should not need mocks for any reason

**P5 -- Data Ownership:**
- Each test file owns its data. Define test data at file scope.
- Use fixture builders for complex domain objects
- Never import test data from another test file

**P6 -- Type-Safe Mocks:**
- No `as any` in mock data
- Use `satisfies` or explicit type annotations
- Use `vi.mocked()` for type-safe mock access

**P7 -- Refactor Sync:**
- Read the CURRENT production file. Use current function signatures.
- Do not copy patterns from old or stale tests.

**P8 -- Output Assertions:**
- Assert on return values and thrown errors
- Assert on I/O boundary call arguments (URL, path, body)
- Do not assert on console output as the primary assertion
- Prefer targeted property assertions over deep-equal on large objects

**P9 -- Determinism:**
- If the function uses `Date` or `Date.now()`: add `vi.useFakeTimers()` +
  `vi.setSystemTime()`
- If using faker directly: call `faker.seed(12345)` at file scope
- If the function uses `Math.random()`: mock it
- If the function reads `process.cwd()`: mock it

**P10 -- Total Cleanup:**
- The global `vitest.setup.ts` provides `afterEach(() => vi.clearAllMocks())`
- Add file-level cleanup ONLY for resources the global setup does not cover:
  - `vi.useFakeTimers()` -> add `afterEach(() => vi.useRealTimers())`
  - `process.env` mutations -> save and restore in `afterEach`
- Do NOT add redundant `vi.clearAllMocks()`

## Step 7: Verify

1. Run `npx tsc --noEmit` -- fix any type errors in the new spec file.
2. Run `pnpm vitest run <path-to-new-spec>` -- all tests must pass.
3. If tests fail because the module has hidden dependencies not visible from
   the type signature, document them as production-code violations (G2).
4. Mentally audit against the 10 principles. Every principle should score clean.

Report: file path, test count, pass/fail, and whether any principle violations
remain.

## What NOT to do

- Do not mock own pure functions, own utilities, or own internal helpers.
- Do not import test data from another test file.
- Do not use `as any` in mock data.
- Do not skip cleanup for timers, env vars, or storage.
- Do not add redundant `vi.clearAllMocks()` (global setup handles it).
- Do not generate snapshot tests for data transformers.
- Do not assert on console output as the primary test assertion.
- Do not test every internal implementation step -- test inputs and outputs.
