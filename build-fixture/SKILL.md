---
name: build-fixture
description: Generate a new domain fixture file for the centralized test data system. Creates faker-backed builders (build, buildMany) that draw from the identity pool for referential integrity. Use when adding test data builders for a new or uncovered domain type.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <domain-name> [description]
---

Generate a new domain fixture. `$ARGUMENTS`

The first token is the domain name (e.g., `notifications` or `workflows`). It maps
to the type module at `src/shared/types/<domain>/index.ts`. Everything after the first
whitespace is an optional description of which types to cover.

<!-- role: workflow -->

## Step 1: Read the domain types

Read `src/shared/types/<domain>/index.ts` (and `<domain>/schemas.ts` if it exists).
Inventory every exported interface and type alias. Note:

- Which fields use branded types (`UserId`, `TeamId`, `ISOTimestamp`, etc.)
- Which fields are optional (`?`) or nullable (`| null`)
- Which fields reference other domains (e.g., a `userId` field)
- Any `as const` objects that define discriminant values

Also read `<domain>/schemas.ts` or the API response schema if it exists.
The Zod schema is the source of truth for data validation, not the
TypeScript interface. Key differences:

- Zod `optional()` accepts `undefined` but NOT `null`
- Zod `nullable()` accepts both `null` and `undefined`
- Zod `transform()` means the post-parse type differs from the input type

If the Zod schema uses `.optional()`, the builder must NOT produce
`null` for that field. Use `undefined` or omit the field entirely.

If the type file does not exist, stop and report: "No type module found at
`src/shared/types/<domain>/index.ts`. Create the types first."

<!-- role: workflow -->

## Step 2: Survey existing fixtures

Read 2-3 existing fixture files in `src/fixtures/domains/` to match conventions:

- `auth.fixture.ts` (simple, single type)
- `users.fixture.ts` (multiple builders, `buildAll` pattern)
- `spans.fixture.ts` (heavy use of brand generators and pool pickers)

Match the import style, function signatures, and spread-merge pattern exactly.

<!-- role: guidance -->

## Step 3: Design the builders

For each type in the domain module, decide:

| Type role              | Builder name      | Notes                                                   |
| ---------------------- | ----------------- | ------------------------------------------------------- |
| Primary entity         | `build`           | The main type gets the bare `build` name                |
| Secondary entity       | `build<TypeName>` | e.g., `buildDatasetStatus`, `buildWorkstreamEntry`      |
| Mapped/derived variant | `buildMapped`     | Computes derived fields from the base builder           |
| Collection helper      | `buildMany`       | Always for the primary entity; add for others if useful |
| Exhaustive builder     | `buildAll`        | Only when the pool defines a finite set (teams, users)  |

Skip types that are:

- Pure input/request types (the test provides these directly)
- Union type aliases with no structure (e.g., `type DatasetKey = 'process' | 'systems'`)
- Types already covered by an existing fixture in another domain

<!-- role: workflow -->

## Step 3b: Trace the BFF handler chain

Before generating field values, trace the full data pipeline for the domain
to understand the post-mapping shape. This prevents fixture drift.

1. **CH query SQL:** Read `src/server/db/queries.ts` for the ClickHouse query
   that feeds the domain. Note column names, aggregations, and expressions.

2. **Row type:** Read `src/server/db/queries.types.ts` for the row type. Note
   which fields are `string` (UInt64 wire format) vs `number`.

3. **Handler logic mapping:** Read the BFF handler(s) that process the query
   results. Trace every field through the mapping:
   - Field renames (e.g., `total_count` -> `totalCount`)
   - Type conversions (e.g., `Number(row.uint64Field)`)
   - Formatting (e.g., `formatDurationSeconds(row.seconds)`)
   - Computed/derived fields (e.g., `timeSaved = usage * CONSTANT`)
   - Percentage scale (0-100 from CH vs 0-1 fraction)

4. **Response Zod schema:** Read the Zod schema that validates the handler
   output. This is the contract the fixture must satisfy.

The fixture must match the **post-mapping** shape (after the handler transforms
the data), not the raw CH wire format. Key rules:

- If the handler converts UInt64 strings to numbers via `Number()`, the
  fixture must produce numbers (not strings).
- If the handler formats durations via `formatDurationSeconds()`, the
  fixture must produce formatted duration strings.
- If the handler computes `timeSaved = usage * CONSTANT`, the fixture
  must maintain that invariant.
- If percentages come from CH at 0-100 scale, the fixture must produce
  0-100 (not 0-1).

<!-- role: emit -->

## Step 4: Generate the fixture file

Create `src/fixtures/domains/<domain>.fixture.ts` following these rules:

### Imports

```typescript
import { faker } from '@faker-js/faker';
import type { MyType, OtherType } from '@/shared/types/<domain>';
// Import brand generators only for fields you need
import { fakeUserId, fakeISOTimestamp, ... } from '../brand';
import { createPool, type Pool } from '../identity-pool';
```

Merge value and type imports from the same module into a single import statement
to avoid `no-duplicate-imports` lint errors.

### Builder signature

Every builder follows this pattern:

```typescript
export function build(overrides?: Partial<MyType>, pool?: Pool): MyType {
  const p = pool ?? createPool();

  const defaults: MyType = {
    // ... faker-backed defaults
  };

  return { ...defaults, ...overrides };
}
```

### Field generation rules

| Field kind                               | Generator                                                    | Example                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Branded ID that references a pool entity | Pool picker                                                  | `p.pickUser().uid`                                                                           |
| Branded ID not in pool                   | Brand generator                                              | `fakeSpanId()`                                                                               |
| Branded timestamp                        | `fakeISOTimestamp()`                                         | `createdAt: fakeISOTimestamp()`                                                              |
| Branded duration                         | `fakeSeconds()`, `fakeMilliseconds()`, `fakeMinutes()`       |                                                                                              |
| Branded percentage                       | `fakePercentage()`                                           |                                                                                              |
| Email from pool identity                 | `identity.email as string`                                   |                                                                                              |
| Optional field                           | `faker.helpers.maybe(() => value, { probability: N })`       | `companyLogoUrl: faker.helpers.maybe(() => faker.image.url(), { probability: 0.3 }) ?? null` |
| Discriminant from `as const`             | `faker.helpers.arrayElement(Object.values(X))`               |                                                                                              |
| Enum-like string                         | `faker.helpers.arrayElement([...])`                          |                                                                                              |
| Free-text string                         | `faker.lorem.words()` or domain-specific faker               |                                                                                              |
| Numeric count/measure                    | `faker.number.int({ min, max })`                             |                                                                                              |
| Boolean                                  | `faker.datatype.boolean()` or hardcoded sensible default     |                                                                                              |
| Nested object                            | Call sibling builder                                         | `teamData: [buildUserTeamData(undefined, p)]`                                                |
| Array of nested                          | `Array.from({ length: N }, () => buildX(undefined, p))`      |                                                                                              |
| System/page names                        | `fakeSystem()`, `fakePageForSystem()`, `fakeSystemAndPage()` |                                                                                              |
| Timestamp pair (start/end)               | `fakeTimestampPair()`                                        | Returns `{ start, end, durationSeconds }`                                                    |

### buildMany signature

```typescript
export function buildMany(
  count: number,
  overrides?: Partial<MyType> | ((i: number) => Partial<MyType>),
  pool?: Pool,
): MyType[] {
  const p = pool ?? createPool();
  return Array.from({ length: count }, (_, i) => build(typeof overrides === 'function' ? overrides(i) : overrides, p));
}
```

For entity types tied to pool entries (users, teams), distribute pool identities
across the array using `i % p.<collection>.length`.

### buildAll signature (only when appropriate)

```typescript
export function buildAll(pool?: Pool): MyType[] {
  const p = pool ?? createPool();
  return buildMany(p.<collection>.length, undefined, p);
}
```

### Integration test fixtures

When building fixtures consumed by integration tests via `page.route()`
interceptors, the fixture must match the raw API response shape
(pre-mapping), not the mapped UI type. The `page.route()` handler
intercepts at the network level, but the app's data-fetching layer
still runs Zod parse and mapper functions on the response.

Check whether the consuming code runs a Zod parse or mapper on the
API response. If so, the fixture must match the input shape to that
parser, not the output shape.

Example: `UserStats` (API shape) vs `MappedUserStats` (UI shape).
The fixture must use `UserStats`.

<!-- role: workflow -->

## Step 5: Update the barrel export

Add the new fixture to `src/fixtures/index.ts`:

```typescript
export * as <domain>Fixtures from './domains/<domain>.fixture';
```

Use camelCase for the namespace (e.g., `urlClassificationFixtures`,
`operationalHoursFixtures`).

<!-- role: workflow -->

## Step 6: Optionally integrate with scenarios

If the new domain is important enough to appear in the standard scenario,
update `src/fixtures/scenario.ts`:

1. Add the type import
2. Add the domain fixture import
3. Add the field to `StandardScenario` interface
4. Call the builder inside `buildStandardScenario()`

Only do this if the user requests it or the domain is a core part of the
application's data model. Most domain fixtures are consumed directly by
individual tests without needing scenario integration.

<!-- role: workflow -->

## Step 7: Verify

1. Run `npx tsc --noEmit -p tsconfig.check.json` — fix any type errors in the new file.
2. Run `npx tsx scripts/AST/ast-query.ts complexity <generated-file> --pretty`.
   Every builder function must have cyclomatic complexity <= 10. If any
   builder exceeds 10, decompose it before proceeding.
3. Run `npx tsx scripts/AST/ast-query.ts type-safety <generated-file> --pretty`.
   Zero `as any` casts. Fixture builders should use `satisfies`, not
   bare `as T` casts. Non-null assertions are acceptable only with a
   comment explaining why the value is guaranteed non-null.
4. Check for lint issues -- especially `no-duplicate-imports` (merge type and
   value imports from the same module) and `no-unused-vars` (remove unused
   imports, or prefix intentionally unused params with `_`).
5. **Fidelity spot-check:** Call `build()` mentally (or in a scratch test)
   and compare one sample item against the Zod schema field-by-field. For
   each field, note the expected wire type:
   - `z.number()` -- is the production value always integer? Float? What range?
   - `z.string()` -- is it a formatted duration? An ISO timestamp? A UInt64?
   - Percentage fields -- is the value 0-100 or 0-1?
   - Duration fields -- milliseconds or seconds?
   If any field's fixture value would not survive a round-trip through the
   BFF handler's mapping logic, fix the builder before proceeding.
6. Report the file path and whether verification passed.

<!-- role: avoid -->

## What NOT to do

- Do not import domain fixtures from the identity pool. Dependency flows:
  `brand.ts` -> `identity-pool.ts` -> `domains/*.fixture.ts` -> `scenario.ts`.
- Do not call `faker.seed()` inside a domain fixture. Seeding is the pool's job.
- Do not hardcode IDs as string literals. Use brand generators or pool pickers.
- Do not skip the `pool` parameter. Even builders for types with no relational
  fields should accept `pool` for consistency.
- Do not create Zod validation tests inside the fixture file. Validation tests
  belong in a separate test file if needed.

**FIXTURE FIDELITY:** Every field in the fixture builder must match the
post-mapping shape of the BFF handler, not just pass the Zod schema.
`z.number()` is not sufficient -- check: is the production value always
integer? Is it milliseconds or seconds? Is it 0-100 or 0-1? Match
the handler output exactly.
