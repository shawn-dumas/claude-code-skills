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
                       - Severity bumps based on confidence
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

The AST tools evolved through four eras:

| Era            | Approach                            | Classification Location                            | Performance   |
| -------------- | ----------------------------------- | -------------------------------------------------- | ------------- |
| Pre-AST        | grep + manual reading               | Human judgment in reports                          | 24s (teams/)  |
| Original AST   | Tools with embedded classifications | `hookCalls[].classification: "service"`            | 78s (teams/)  |
| Current        | Observation/assessment separation   | Observations in tools, assessments in interpreters | 68s (teams/)  |
| Current+Cached | Current + content-addressed caching | Same as Current                                    | 9.4s (teams/) |

**The bottom line:** Current+Cached delivers the richest data (confidence levels,
rationale, traceability) at near-grep speeds. The cache provides 76x speedup for
full codebase scans.

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

All observation tools support content-addressed caching for massive speedups
on repeated analysis.

### How It Works

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

- Cache location: `.ast-cache/` (gitignored)
- Key format: `{tool}-{contentHash}.json`
- Auto-invalidates when `ast-config.ts` changes (config hash in manifest)

### Usage

```bash
# Warm cache for entire codebase (one-time, ~66s)
npx tsx scripts/AST/ast-cache-warm.ts

# Warm cache for specific directory
npx tsx scripts/AST/ast-cache-warm.ts src/ui/page_blocks/teams/

# Subsequent tool runs use cache automatically
npx tsx scripts/AST/ast-react-inventory.ts src/ui/page_blocks/teams/
# Output: Cache: 12 hits, 0 misses

# Bypass cache and force re-analysis
npx tsx scripts/AST/ast-react-inventory.ts src/ui/page_blocks/teams/ --no-cache
```

### Performance

| Scenario             | Cold (no cache) | Warm (cached) | Speedup |
| -------------------- | --------------- | ------------- | ------- |
| teams/ (16 files)    | 11.9s           | 9.4s          | 1.3x    |
| Full codebase (1431) | 66s             | 865ms         | 76x     |

**Why speedup varies:** ts-morph initialization is ~500ms fixed cost per tool
invocation. For small directories, this overhead dominates. For large directories,
analysis time dominates and caching provides dramatic speedup.

### Cache Invalidation

The cache auto-invalidates in these scenarios:

1. **File content changes:** SHA256 hash differs
2. **Config changes:** `ast-config.ts` modification time changes
3. **Manual clear:** `rm -rf .ast-cache/`

## Tool Inventory

### Observation Tools

These emit structural facts with no classifications.

| Tool                  | Observations Emitted                                                | Purpose                            |
| --------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| `ast-react-inventory` | HOOK_CALL, COMPONENT_DECLARATION, PROP_FIELD, EFFECT_LOCATION       | React component/hook structure     |
| `ast-complexity`      | FUNCTION_COMPLEXITY                                                 | Cyclomatic complexity per function |
| `ast-type-safety`     | AS_ANY_CAST, AS_UNKNOWN_AS_CAST, NON_NULL_ASSERTION, TS_DIRECTIVE   | Type safety violations             |
| `ast-side-effects`    | CONSOLE_CALL, TOAST_CALL, TIMER_CALL, POSTHOG_CALL, WINDOW_MUTATION | Side effect detection              |
| `ast-storage-access`  | DIRECT_STORAGE_CALL, TYPED_STORAGE_CALL, COOKIE_CALL                | Storage API usage                  |
| `ast-env-access`      | PROCESS_ENV_ACCESS, ENV_WRAPPER_ACCESS                              | Environment variable access        |
| `ast-feature-flags`   | FLAG_HOOK_CALL, FLAG_READ, PAGE_GUARD, CONDITIONAL_RENDER           | Feature flag usage                 |
| `ast-jsx-analysis`    | JSX_TERNARY_CHAIN, JSX_GUARD_CHAIN, JSX_TRANSFORM_CHAIN, JSX_IIFE   | JSX complexity                     |
| `ast-imports`         | STATIC_IMPORT, EXPORT_DECLARATION, CIRCULAR_DEPENDENCY, DEAD_EXPORT | Import graph analysis              |
| `ast-data-layer`      | QUERY_HOOK_DEFINITION, FETCH_API_CALL, QUERY_KEY_FACTORY            | Data fetching patterns             |
| `ast-test-analysis`   | MOCK_DECLARATION, ASSERTION_CALL, RENDER_CALL, CLEANUP_CALL         | Test file structure                |

### Interpreters

These consume observations and emit assessments with confidence and rationale.

| Interpreter                  | Input Observations                           | Output Assessments                                                                             |
| ---------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ast-interpret-hooks`        | HOOK_CALL                                    | LIKELY_SERVICE_HOOK, LIKELY_STATE_HOOK, LIKELY_AMBIENT_HOOK, LIKELY_CONTEXT_HOOK, UNKNOWN_HOOK |
| `ast-interpret-ownership`    | COMPONENT_DECLARATION, HOOK_CALL assessments | CONTAINER, DDAU_COMPONENT, LAYOUT_EXCEPTION                                                    |
| `ast-interpret-effects`      | EFFECT_LOCATION, side effect observations    | LEGITIMATE_EFFECT, SUSPICIOUS_EFFECT, VIOLATION_EFFECT                                         |
| `ast-interpret-template`     | JSX\_\* observations                         | COMPLEX_TEMPLATE, NEEDS_EXTRACTION                                                             |
| `ast-interpret-dead-code`    | STATIC_IMPORT, EXPORT_DECLARATION            | DEAD_EXPORT, UNUSED_IMPORT                                                                     |
| `ast-interpret-test-quality` | MOCK_DECLARATION, ASSERTION_CALL, etc.       | INTERNAL_MOCK, STALE_MOCK, MISSING_CLEANUP, etc.                                               |

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
```

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
import { parseArgs, output } from './cli';
import { getSourceFile, PROJECT_ROOT } from './project';
import type { MyObservation } from './types';

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

// CLI entry point
const isDirectRun = process.argv[1]?.endsWith('ast-my-analysis.ts');
if (isDirectRun) {
  const args = parseArgs(process.argv);
  const result = analyzeMyThing(args.paths[0]);
  output(result, args.pretty);
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
