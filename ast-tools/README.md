# AST Analysis Tools

Static analysis tools for React/TypeScript codebases. These tools power the
audit and refactor skills by providing structured, machine-parseable code
analysis.

## Design Philosophy

The tools follow a **three-layer architecture** that separates facts from
judgments:

```
Source Code
    |
    v
+-------------------+
|   AST Tools       |  Layer 1: Observations
|   (ast-*.ts)      |  - Line-anchored structural facts
+-------------------+  - No classifications or judgments
    |                  - Output: { kind, file, line, evidence }
    v
+-------------------+
|   Interpreters    |  Layer 2: Assessments
|   (ast-interpret-)|  - Classifications over observations
+-------------------+  - Confidence levels (high/medium/low)
    |                  - Rationale explaining WHY
    v                  - Output: { kind, confidence, rationale, basedOn }
+-------------------+
|   Skills          |  Layer 3: Reports
|   (SKILL.md)      |  - Policy decisions
+-------------------+  - [AST-confirmed] tagging
    |                  - Severity bumps based on confidence
    v (feedback fixtures on misclassification)
+-------------------+
|   Calibration     |  Feedback loop: fixture -> measure -> tune -> config
|   (/calibrate-*)  |  Operates on Layer 2 weights/thresholds in ast-config.ts
+-------------------+
```

### Why Three Layers?

**Separation of concerns.** Tools emit facts ("there is a useEffect at line 42
with these dependencies"). Interpreters make judgments ("this effect is likely
synchronizing external state"). Skills apply policy ("effects with external
sync are medium severity violations").

**Traceability.** Every assessment links back to the observations it's based
on via the `basedOn` field. Auditors can trace any finding to its source.

**Extensibility.** Adding new classification rules doesn't require changing
tools. Update `ast-config.ts` or the interpreter logic. The observation
layer stays stable.

**Explicit uncertainty.** When the interpreter doesn't know, it says so:
`UNKNOWN_HOOK` with `confidence: "low"` and `requiresManualReview: true`.
No silent guessing.

## Evolution

The AST tools evolved through five eras:

| Era              | Approach                            | Classification Location                            | Performance   |
| ---------------- | ----------------------------------- | -------------------------------------------------- | ------------- |
| Pre-AST          | grep + manual reading               | Human judgment in reports                          | 24s (teams/)  |
| Original AST     | Tools with embedded classifications | `hookCalls[].classification: "service"`            | 78s (teams/)  |
| Current          | Observation/assessment separation   | Observations in tools, assessments in interpreters | 68s (teams/)  |
| Current+Cached   | Current + file-level caching        | Same as Current                                    | 9.4s (teams/) |
| Current+DirCache | Current + file + directory caching  | Same as Current                                    | 8s (teams/)   |
| Calibrated       | DirCache + ground truth feedback    | Same as Current, weights tuned by fixture corpus   | 8s (teams/)   |

**The bottom line:** Current+DirCache delivers the richest data (confidence levels,
rationale, traceability) at near-grep speeds. The two-level cache provides 76x
speedup for full codebase scans and 8.5x speedup for single-directory audits.

### Why This Matters

**Idempotency.** With grep-based audits, running the same audit twice could
produce different classifications because the agent reasoned differently each
time. Frustrating when you're trying to track progress or compare runs.
With interpreter-based classification, same code = same output, every time.

**Hidden costs of Pre-AST.** Grep output is small (~6 KB), but the agent had
to read source files (~22 KB) to manually classify hooks and components.
That file content goes into context, and the agent burns tokens reasoning
about "is this a service hook? is this a container?" Current eliminates
that reasoning entirely -- the interpreter outputs `LIKELY_SERVICE_HOOK,
confidence: high` and the agent just reads structured JSON.

### Limitations of Embedded Classifications

The current architecture emerged from limitations of the original AST approach:

- Hardcoded rules required tool changes to evolve
- No confidence levels (everything was certain or "unknown")
- No rationale (couldn't explain WHY something was classified)
- No traceability (couldn't link findings to source evidence)

## Caching

The tools support a two-level content-addressed cache for massive speedups:

1. **File-level cache** (observation tools): Caches results per-file
2. **Directory-level cache** (interpreters): Caches assessment results per-directory

### How It Works

**File-level caching (observations):**

```
File Content -> SHA256 Hash -> Cache Lookup
                                  |
                         +--------+--------+
                         |                 |
                     Cache Hit         Cache Miss
                         |                 |
                    Return JSON       Run Analysis
                                          |
                                    Write to Cache
                                          |
                                     Return JSON
```

**Directory-level caching (interpreters):**

```
Directory Files -> Hash each file -> Sort hashes -> SHA256(joined)
                                                         |
                                                   Dir Hash
                                                         |
                                              +----------+----------+
                                              |                     |
                                          Cache Hit             Cache Miss
                                              |                     |
                                      Return Assessments    Run Observations
                                                                    |
                                                            Run Interpreter
                                                                    |
                                                            Write to Cache
                                                                    |
                                                           Return Assessments
```

- Cache location: `.ast-cache/` (gitignored)
- File key format: `{tool}-{contentHash}.json`
- Directory key format: `{tool}-dir-{dirHash}.json`
- Auto-invalidates when `ast-config.ts` changes (config hash in manifest)
- Directory cache invalidates when any file in directory changes

### Usage

```bash
# Warm observation cache for entire codebase (one-time, ~66s)
npx tsx scripts/AST/ast-cache-warm.ts

# Warm cache for specific directory
npx tsx scripts/AST/ast-cache-warm.ts src/ui/page_blocks/teams/

# Subsequent observation tool runs use file cache
npx tsx scripts/AST/ast-react-inventory.ts src/ui/page_blocks/teams/
# Output: Cache: 12 hits, 0 misses

# First interpreter run populates directory cache
npx tsx scripts/AST/ast-interpret-hooks.ts src/ui/page_blocks/teams/
# Output: Cache: 0 hits, 1 misses

# Second interpreter run hits directory cache
npx tsx scripts/AST/ast-interpret-hooks.ts src/ui/page_blocks/teams/
# Output: Cache: 1 hits, 0 misses

# Bypass cache and force re-analysis
npx tsx scripts/AST/ast-react-inventory.ts src/ui/page_blocks/teams/ --no-cache
```

### Performance

| Scenario             | Cold | File-cached | Dir-cached | Speedup |
| -------------------- | ---- | ----------- | ---------- | ------- |
| teams/ (16 files)    | 68s  | 9.4s        | 8s         | 8.5x    |
| Full codebase (1431) | 66s  | 865ms       | 865ms      | 76x     |

**Interpreter timing (teams/ directory):**

| Interpreter             | Cold | Dir-cached | Speedup |
| ----------------------- | ---- | ---------- | ------- |
| ast-interpret-hooks     | 2.1s | 1.1s       | 1.9x    |
| ast-interpret-effects   | 2.6s | 0.9s       | 2.9x    |
| ast-interpret-ownership | 2.3s | 1.0s       | 2.3x    |

**Why speedup varies:** ts-morph initialization is ~500ms fixed cost per tool
invocation. For small directories, this overhead dominates. For large directories,
analysis time dominates and caching provides dramatic speedup. Directory-level
caching helps interpreters by avoiding re-analysis when files haven't changed.

### Cache Invalidation

The cache auto-invalidates in these scenarios:

1. **File content changes:** SHA256 hash differs (invalidates file + directory caches)
2. **Config changes:** `ast-config.ts` modification time changes (clears entire cache)
3. **Manual clear:** `rm -rf .ast-cache/`

### Cache Storage

- Location: `.ast-cache/` (gitignored)
- Size: ~2.8 MB for full codebase (6491 cached results)
- Format: JSON files with deterministic naming

## Tool Inventory

### Observation Tools

These emit structural facts with no classifications.

| Tool                  | Observations Emitted                                                                                                                  | Purpose                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `ast-imports`         | STATIC_IMPORT, DYNAMIC_IMPORT, EXPORT_DECLARATION, CIRCULAR_DEPENDENCY, DEAD_EXPORT_CANDIDATE                                         | Import graph analysis              |
| `ast-react-inventory` | HOOK*CALL, EFFECT_LOCATION, EFFECT*\*, COMPONENT_DECLARATION, PROP_FIELD                                                              | React component/hook structure     |
| `ast-jsx-analysis`    | JSX_TERNARY_CHAIN, JSX_GUARD_CHAIN, JSX_TRANSFORM_CHAIN, JSX_IIFE, JSX_INLINE_HANDLER, JSX_RETURN_BLOCK                               | JSX complexity                     |
| `ast-test-analysis`   | MOCK_DECLARATION, ASSERTION_CALL, RENDER_CALL, CLEANUP_CALL, FIXTURE_IMPORT                                                           | Test file structure                |
| `ast-complexity`      | FUNCTION_COMPLEXITY                                                                                                                   | Cyclomatic complexity per function |
| `ast-data-layer`      | QUERY_HOOK_DEFINITION, MUTATION_HOOK_DEFINITION, FETCH_API_CALL, QUERY_KEY_FACTORY                                                    | Data fetching patterns             |
| `ast-side-effects`    | CONSOLE_CALL, TOAST_CALL, TIMER_CALL, POSTHOG_CALL, WINDOW_MUTATION                                                                   | Side effect detection              |
| `ast-storage-access`  | DIRECT_STORAGE_CALL, TYPED_STORAGE_CALL, JSON_PARSE_CALL, COOKIE_CALL                                                                 | Storage API usage                  |
| `ast-env-access`      | PROCESS_ENV_ACCESS, ENV_WRAPPER_ACCESS, ENV_WRAPPER_IMPORT                                                                            | Environment variable access        |
| `ast-feature-flags`   | FLAG_HOOK_CALL, FLAG_READ, PAGE_GUARD, CONDITIONAL_RENDER                                                                             | Feature flag usage                 |
| `ast-type-safety`     | AS_ANY_CAST, NON_NULL_ASSERTION, TS_DIRECTIVE, TRUST_BOUNDARY_CAST                                                                    | Type safety violations             |
| `ast-pw-test-parity`  | PW_TEST_BLOCK, PW_ASSERTION, PW_ROUTE_INTERCEPT, PW_NAVIGATION, PW_POM_USAGE, PW_AUTH_CALL, PW_SERIAL_MODE, PW_BEFORE_EACH            | Playwright spec structure          |
| `ast-refactor-intent` | INTENT_SIGNAL_BEFORE, INTENT_SIGNAL_AFTER, INTENT_SIGNAL_PAIR                                                                         | Refactor intent signal matching    |
| `ast-vitest-parity`   | VT_DESCRIBE_BLOCK, VT_TEST_BLOCK, VT_ASSERTION, VT_MOCK_DECLARATION, VT_RENDER_CALL, VT_FIXTURE_IMPORT, VT_BEFORE_EACH, VT_AFTER_EACH | Vitest spec structure              |

### Interpreters

These consume observations and emit assessments with confidence and rationale.

| Interpreter                     | Input Observations                           | Output Assessments                                                                             |
| ------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ast-interpret-hooks`           | HOOK_CALL                                    | LIKELY_SERVICE_HOOK, LIKELY_STATE_HOOK, LIKELY_AMBIENT_HOOK, LIKELY_CONTEXT_HOOK, UNKNOWN_HOOK |
| `ast-interpret-ownership`       | COMPONENT_DECLARATION, HOOK_CALL assessments | CONTAINER, DDAU_COMPONENT, LAYOUT_EXCEPTION                                                    |
| `ast-interpret-effects`         | EFFECT_LOCATION, side effect observations    | LEGITIMATE_EFFECT, SUSPICIOUS_EFFECT, VIOLATION_EFFECT                                         |
| `ast-interpret-template`        | JSX\_\* observations                         | COMPLEX_TEMPLATE, NEEDS_EXTRACTION                                                             |
| `ast-interpret-dead-code`       | STATIC_IMPORT, EXPORT_DECLARATION            | DEAD_EXPORT, UNUSED_IMPORT                                                                     |
| `ast-interpret-test-quality`    | MOCK_DECLARATION, ASSERTION_CALL, etc.       | INTERNAL_MOCK, STALE_MOCK, MISSING_CLEANUP, etc.                                               |
| `ast-interpret-pw-test-parity`  | PW_TEST_BLOCK, PW_ASSERTION, etc.            | PARITY, EXPANDED, REDUCED, NOT_PORTED                                                          |
| `ast-interpret-refactor-intent` | INTENT_SIGNAL_PAIR                           | PRESERVED, INTENTIONALLY_REMOVED, ACCIDENTALLY_DROPPED, ADDED                                  |
| `ast-interpret-vitest-parity`   | VT_TEST_BLOCK, VT_ASSERTION, etc.            | PARITY, EXPANDED, REDUCED, NOT_PORTED                                                          |

## Usage

### CLI

All tools accept file paths or directories and output JSON by default:

```bash
# Single file
npx tsx ast-complexity.ts src/components/Button.tsx

# Directory (recursive)
npx tsx ast-react-inventory.ts src/ui/page_blocks/teams/

# Pretty output (human-readable table)
npx tsx ast-interpret-hooks.ts src/ui/page_blocks/teams/ --pretty

# Filter by observation kind
npx tsx ast-test-analysis.ts src/ui/page_blocks/dashboard/ --kind MOCK_DECLARATION

# Count mode for verification
npx tsx ast-test-analysis.ts src/ui/page_blocks/dashboard/ --kind TIMER_NEGATIVE_ASSERTION --count

# Scan test files with any tool
npx tsx ast-type-safety.ts src/ui/page_blocks/dashboard/ --test-files --kind AS_UNKNOWN_AS_CAST

# Multi-file
npx tsx ast-type-safety.ts src/shared/utils/date/*.ts src/shared/utils/string/*.ts
```

### CLI Flags

All observation tools accept these flags:

- `--pretty` -- human-readable JSON output
- `--kind <KIND>` -- filter observations to a single kind
- `--count` -- output observation kind counts (e.g., `{"MOCK_DECLARATION": 5}`)
- `--test-files` -- scan test/spec files instead of production files
- `--no-cache` -- bypass the file-content cache

### Observation Output Structure

```typescript
interface Observation {
  kind: string; // e.g., "HOOK_CALL", "FUNCTION_COMPLEXITY"
  file: string; // Relative file path
  line: number; // 1-indexed line number
  column?: number; // 1-indexed column (when available)
  evidence: {
    // Structured details (varies by kind)
    // ...
  };
}
```

Example observation from `ast-react-inventory`:

```json
{
  "kind": "HOOK_CALL",
  "file": "src/ui/page_blocks/teams/TeamsListContainer.tsx",
  "line": 19,
  "evidence": {
    "hookName": "useTeamsListQuery",
    "importSource": "src/ui/services/hooks/queries/teams/index.ts",
    "destructuredNames": ["teams", "isFetching"],
    "parentFunction": "TeamsListContainer",
    "isReactBuiltin": false
  }
}
```

### Assessment Output Structure

```typescript
interface Assessment {
  kind: string; // e.g., "LIKELY_SERVICE_HOOK"
  subject: {
    file: string;
    line: number;
    symbol?: string; // Function/component name
  };
  confidence: 'high' | 'medium' | 'low';
  rationale: string[]; // Human-readable reasons
  basedOn: ObservationRef[]; // Links to source observations
  isCandidate: boolean; // Flagged for DDAU review
  requiresManualReview: boolean; // Interpreter uncertainty
}
```

Example assessment from `ast-interpret-hooks`:

```json
{
  "kind": "LIKELY_SERVICE_HOOK",
  "subject": {
    "file": "src/ui/page_blocks/teams/TeamsListContainer.tsx",
    "line": 19,
    "symbol": "useTeamsListQuery"
  },
  "confidence": "high",
  "rationale": [
    "imports from 'src/ui/services/hooks/queries/teams/index.ts' (matches service hook path pattern 'services/hooks')"
  ],
  "basedOn": [{ "kind": "HOOK_CALL", "file": "...", "line": 19 }],
  "isCandidate": true,
  "requiresManualReview": false
}
```

### Programmatic Usage

Each tool exports an `analyze*` function for use in other tools or scripts:

```typescript
import { analyzeReactFile } from './ast-react-inventory';
import { interpretHooks } from './ast-interpret-hooks';

const inventory = analyzeReactFile('src/components/MyComponent.tsx');
const assessments = interpretHooks(inventory.hookObservations);

for (const a of assessments.assessments) {
  if (a.kind === 'LIKELY_SERVICE_HOOK' && a.isCandidate) {
    console.log(`Service hook at ${a.subject.file}:${a.subject.line}`);
  }
}
```

## Configuration

All repo-specific conventions live in `ast-config.ts`. This is the single
source of truth for patterns, thresholds, and known identifiers.

### Key Configuration Sections

```typescript
astConfig.hooks.ambientLeafHooks; // Hooks allowed anywhere (useBreakpoints, useRouter, etc.)
astConfig.hooks.tanstackQueryHooks; // TanStack Query hooks (useQuery, useQueryClient, etc.)
astConfig.hooks.serviceHookPathPatterns; // Path patterns for service hooks
astConfig.hooks.contextHookPathPatterns; // Path patterns for context hooks

astConfig.ownership.containerSuffixes; // Suffixes that indicate containers
astConfig.ownership.routerHooks; // Router hooks (useRouter, usePathname, etc.)

astConfig.testing.boundaryPackages; // Packages that should be mocked at test boundaries
astConfig.testing.fixtureImportPatterns; // Patterns for fixture imports

astConfig.jsx.thresholds; // Complexity thresholds for JSX analysis

astConfig.intentMatcher.signalWeights; // Per-observation-kind weights for intent scoring
astConfig.intentMatcher.thresholds; // Fail/warn thresholds for similarity classification
astConfig.intentMatcher.ignoredKinds; // Observation kinds excluded from intent matching
// Managed by /calibrate-ast-interpreter --tool intent
// Current accuracy: 100% (55/55) on 9 fixtures (7 synthetic, 2 git-history)

astConfig.testParity.fileMapping; // Source spec -> target spec filename mapping
astConfig.testParity.helperDirs; // Directories to scan for POM/helper files
astConfig.testParity.authMethods; // Auth method detection strings
// Managed by /calibrate-ast-interpreter --tool parity
// Current accuracy: 100% (26/26) on 9 fixtures (3 synthetic, 6 git-history)
// See docs/ast-parity-matching.md for full algorithm reference
// See docs/ast-observation-signals.md for signal extraction details
```

### Adding New Hook Patterns

To classify a new hook, add it to the appropriate set in `ast-config.ts`:

```typescript
// For ambient/utility hooks allowed anywhere:
ambientLeafHooks: new Set([
  'useBreakpoints',
  'useMyNewUtilityHook', // Add here
]);

// For TanStack Query hooks:
tanstackQueryHooks: new Set([
  'useQuery',
  'useMyCustomQueryHook', // Add here
]);
```

## Adding New Tools

### Observation Tool Pattern

```typescript
// ast-my-analysis.ts
import { parseArgs, outputFiltered, fatal } from './cli';
import { getSourceFile, PROJECT_ROOT } from './project';
import { getFilesInDirectory } from './shared';
import type { MyObservation, FileFilter } from './types';

interface MyAnalysisResult {
  filePath: string;
  observations: MyObservation[];
}

export function analyzeMyThing(filePath: string): MyAnalysisResult {
  const sourceFile = getSourceFile(filePath);
  const observations: MyObservation[] = [];

  // Walk the AST and emit observations
  sourceFile.forEachDescendant((node) => {
    if (/* matches pattern */) {
      observations.push({
        kind: 'MY_OBSERVATION',
        file: filePath,
        line: node.getStartLineNumber(),
        evidence: {
          // Structured details
        },
      });
    }
  });

  return { filePath, observations };
}

export function analyzeMyThingDirectory(dir: string, filter?: FileFilter): MyAnalysisResult[] {
  const files = getFilesInDirectory(dir, filter);
  return files.map(f => analyzeMyThing(f));
}

// CLI entry point
const isDirectRun = process.argv[1]?.endsWith('ast-my-analysis.ts');
if (isDirectRun) {
  const args = parseArgs(process.argv);
  if (args.paths.length === 0) fatal('Provide at least one file or directory path');

  const filter: FileFilter | undefined = args.flags.has('test-files') ? 'test' : undefined;
  const results: MyAnalysisResult[] = [];
  for (const p of args.paths) {
    results.push(analyzeMyThing(p));
  }

  outputFiltered(results, args.pretty, { kind: args.options.kind, count: args.flags.has('count') });
}
```

### Interpreter Pattern

```typescript
// ast-interpret-my-thing.ts
import { astConfig } from './ast-config';
import type { MyObservation, MyAssessment, AssessmentResult } from './types';

export function interpretMyThing(observations: readonly MyObservation[]): AssessmentResult<MyAssessment> {
  const assessments: MyAssessment[] = [];

  for (const obs of observations) {
    // Classify based on evidence + config
    const result = classifyObservation(obs, astConfig);

    assessments.push({
      kind: result.kind,
      subject: { file: obs.file, line: obs.line },
      confidence: result.confidence,
      rationale: result.rationale,
      basedOn: [{ kind: obs.kind, file: obs.file, line: obs.line }],
      requiresManualReview: result.confidence === 'low',
    });
  }

  return { assessments };
}
```

### Type Definitions

Add observation and assessment types to `types.ts`:

```typescript
export interface MyObservation {
  kind: 'MY_OBSERVATION';
  file: string;
  line: number;
  evidence: {
    someField: string;
    anotherField: number;
  };
}

export type MyAssessmentKind = 'GOOD_PATTERN' | 'BAD_PATTERN' | 'UNKNOWN';

export interface MyAssessment extends BaseAssessment {
  kind: MyAssessmentKind;
}
```

## Testing

Tests live in `__tests__/` with fixtures in `__tests__/fixtures/`.

```bash
# Run all AST tool tests
npx vitest run --config vitest.config.mts

# Run specific tool tests
npx vitest run ast-complexity.spec.ts
```

## Integration with Skills

Skills use AST tools in their "Step 0: Run AST analysis" phase:

```markdown
## Step 0: Run AST Analysis

Run these tools and capture output:

\`\`\`bash
npx tsx scripts/AST/ast-react-inventory.ts <target-dir> > inventory.json
npx tsx scripts/AST/ast-interpret-hooks.ts <target-dir> > hooks.json
npx tsx scripts/AST/ast-interpret-ownership.ts <target-dir> > ownership.json
\`\`\`

Use the assessment output to:

- Classify components as containers vs. presentational
- Identify service hooks that should only appear in containers
- Flag items with `requiresManualReview: true` for closer inspection
- Tag findings as `[AST-confirmed]` when confidence is high
```

## Design Decisions

**Why ts-morph?** It provides a high-level API over the TypeScript compiler
AST with good ergonomics for analysis tasks. The tradeoff is startup time
(~500ms to initialize the project), but this is acceptable for audit tools
that run infrequently.

**Why JSON output?** Machine-parseable output enables aggregation across
files, tracking over time, and integration with other tools. The `--pretty`
flag provides human-readable output when needed.

**Why config-driven classification?** Embedding classification rules in
tools creates maintenance burden and version coupling. Centralizing rules
in `ast-config.ts` allows repo-specific customization without forking tools.

**Why explicit confidence levels?** Binary certain/unknown classifications
hide the quality of evidence. Confidence levels let skills make policy
decisions: "only tag [AST-confirmed] when confidence is high."
