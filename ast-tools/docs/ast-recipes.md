# AST Tool Recipes

How to answer common codebase questions using AST tools instead of
`rg`, `sg`, `grep`, or the built-in Grep tool. Every recipe shows the
wrong way (grep-like) and the right way (AST tool).

**Rule:** For TypeScript source code in `src/`, `integration/`, and
`scripts/`, always use the highest-tier tool available. See the tool
hierarchy in CLAUDE.md. This document is the lookup table for
translating grep impulses into AST tool invocations.

For the full tool inventory and observation kinds, see `scripts/AST/CLAUDE.md`.

---

## 1. Import and Consumer Tracing

### "Who imports symbol X?"

```bash
# WRONG
rg "RealtimeActivityContainer" src/ --files-with-matches
rg "from.*operational-hours" src/ -g "*.ts" -g "*.tsx" -l
grep -r "OperationalHoursVariant" src/shared/types/ --include="*.ts"

# RIGHT
npx tsx scripts/AST/ast-imports.ts src/ --symbol RealtimeActivityContainer --pretty
npx tsx scripts/AST/ast-imports.ts src/ --symbol OperationalHoursVariant --pretty
```

`--symbol <name>` filters the import graph to files that import that
specific named export. Returns the file path, source module, line
number, and all specifiers from that import.

### "Who consumes this file?"

```bash
# WRONG
rg "from.*operationalHoursUtils" src/ -g "*.ts" -l
rg "import.*from.*./MyComponent" src/ --files-with-matches

# RIGHT
npx tsx scripts/AST/ast-imports.ts --consumers src/shared/utils/operationalHoursUtils.ts --pretty
npx tsx scripts/AST/ast-imports.ts --consumers src/ui/page_blocks/dashboard/chat/ChatContainer.tsx --pretty
```

`--consumers <file>` is a reverse lookup: given a file, find every file
that imports it.

### "What does this directory import from outside itself?"

```bash
# WRONG
rg "from '../" src/ui/page_blocks/dashboard/operational-status/ --no-filename
rg "from '@/page_blocks/" src/ui/page_blocks/dashboard/operational-status/

# RIGHT
npx tsx scripts/AST/ast-imports.ts src/ui/page_blocks/dashboard/operational-status/ --pretty
```

The default mode builds the full dependency graph for all files in the
directory. External imports (outside the directory) are visible in each
file's `imports` array. Filter by `source` prefix if needed.

### "Are there circular dependencies?"

```bash
# WRONG
rg "from.*fileA" fileB.ts && rg "from.*fileB" fileA.ts

# RIGHT
npx tsx scripts/AST/ast-imports.ts src/ui/page_blocks/dashboard/ --kind CIRCULAR_DEPENDENCY --pretty
```

### "Are there dead exports?"

```bash
# WRONG
rg "export.*myFunction" src/ -l  # then manually check if anything imports it

# RIGHT
npx tsx scripts/AST/ast-imports.ts src/ui/page_blocks/dashboard/ --kind DEAD_EXPORT_CANDIDATE --pretty
```

---

## 2. Complexity and Function Analysis

### "What's the cyclomatic complexity of this file/function?"

```bash
# WRONG
rg "if \(|&&|\|\||\\?" src/ui/page_blocks/dashboard/systems/useSystemsUrlState.ts | wc -l

# RIGHT
npx tsx scripts/AST/ast-complexity.ts src/ui/page_blocks/dashboard/systems/useSystemsUrlState.ts --pretty
```

Returns per-function CC scores with breakdown by branch type (if,
ternary, nullish-coalesce, logical-and, logical-or, switch-case).

### "Which functions exceed CC threshold?"

```bash
# WRONG
# (no grep equivalent -- would require parsing)

# RIGHT
npx tsx scripts/AST/ast-complexity.ts src/ui/page_blocks/dashboard/ --pretty
# Then filter output for CC >= 15 (P2 threshold) or CC >= 25 (P1)
```

---

## 3. Type Safety

### "Any `as any` or `as unknown` casts?"

```bash
# WRONG
rg "as any" src/ui/page_blocks/dashboard/ --type ts
rg "as unknown" src/ui/page_blocks/dashboard/ --type ts

# RIGHT
npx tsx scripts/AST/ast-type-safety.ts src/ui/page_blocks/dashboard/ --pretty
# or filter to specific kinds:
npx tsx scripts/AST/ast-type-safety.ts src/ui/page_blocks/dashboard/ --kind AS_ANY_CAST --pretty
```

### "Any non-null assertions (!)?"

```bash
# WRONG
rg '!\.' src/ --type ts  # too noisy, matches !== and other patterns

# RIGHT
npx tsx scripts/AST/ast-type-safety.ts src/ui/page_blocks/dashboard/ --kind NON_NULL_ASSERTION --pretty
```

### "Any trust boundary casts?"

```bash
# WRONG
rg "as.*Response" src/ --type ts

# RIGHT
npx tsx scripts/AST/ast-type-safety.ts src/ --kind TRUST_BOUNDARY_CAST --pretty
```

---

## 4. React Component and Hook Analysis

### "What hooks does this component call?"

```bash
# WRONG
rg "use[A-Z]" src/ui/page_blocks/dashboard/team/TeamContainer.tsx

# RIGHT
npx tsx scripts/AST/ast-react-inventory.ts src/ui/page_blocks/dashboard/team/TeamContainer.tsx --kind HOOK_CALL --pretty
```

### "How many useEffects are in this directory?"

```bash
# WRONG
rg "useEffect" src/ui/page_blocks/dashboard/ -c

# RIGHT
npx tsx scripts/AST/ast-react-inventory.ts src/ui/page_blocks/dashboard/ --kind EFFECT_LOCATION --count
```

### "What are the useEffects doing? Are any eliminable?"

```bash
# WRONG
rg -A 10 "useEffect" src/ui/page_blocks/dashboard/team/  # then read manually

# RIGHT
npx tsx scripts/AST/ast-interpret-effects.ts src/ui/page_blocks/dashboard/team/ --pretty
```

Returns classifications: DERIVED_STATE (eliminable), EVENT_HANDLER_DISGUISED
(eliminable), TIMER_RACE (bug), DOM_EFFECT, EXTERNAL_SUBSCRIPTION, NECESSARY.

### "Is this a container or a component?"

```bash
# WRONG
rg "useRouter\|useAuthState\|usePosthogContext" src/ui/page_blocks/dashboard/team/TeamBlock.tsx

# RIGHT
npx tsx scripts/AST/ast-interpret-ownership.ts src/ui/page_blocks/dashboard/team/ --pretty
```

### "What props does this component take?"

```bash
# WRONG
rg "interface.*Props" src/ui/page_blocks/dashboard/team/TeamBlock.tsx

# RIGHT
npx tsx scripts/AST/ast-react-inventory.ts src/ui/page_blocks/dashboard/team/TeamBlock.tsx --kind PROP_FIELD --pretty
```

---

## 5. Test Analysis

### "How are mocks set up in this test?"

```bash
# WRONG
rg "vi.mock\|jest.mock" src/ui/page_blocks/dashboard/team/__tests__/ --type ts

# RIGHT
npx tsx scripts/AST/ast-test-analysis.ts src/ui/page_blocks/dashboard/team/__tests__/ --kind MOCK_DECLARATION --pretty
```

Returns mock type (boundary vs internal), target module, and whether
the mock matches current production signatures.

### "Any internal mocking violations?"

```bash
# WRONG
rg "vi.mock.*\.\.\/" src/ui/page_blocks/dashboard/ --type ts  # misses alias paths

# RIGHT
npx tsx scripts/AST/ast-test-analysis.ts src/ui/page_blocks/dashboard/ --pretty
# Then check for MOCK_DECLARATION observations where mockType !== 'boundary'
# Or use the interpreter:
npx tsx scripts/AST/ast-interpret-test-quality.ts src/ui/page_blocks/dashboard/ --pretty
# MOCK_INTERNAL_VIOLATION assessments flag the violations directly
```

### "Which production files have no test coverage?"

```bash
# WRONG
find src/ui/page_blocks/dashboard/systems -name '*.tsx' | while read f; do
  base=$(basename "$f" .tsx)
  if ! find . -name "${base}.spec.*" | grep -q .; then echo "UNTESTED: $f"; fi
done

# RIGHT
npx tsx scripts/AST/ast-test-coverage.ts src/ui/page_blocks/dashboard/systems/ --pretty
# Returns TESTED/INDIRECTLY_TESTED/UNTESTED with risk scores (CC + lines + consumers)
# Use the interpreter for prioritized findings:
npx tsx scripts/AST/ast-interpret-test-coverage.ts src/ui/page_blocks/dashboard/systems/ --pretty
```

### "What assertions does this test file use?"

```bash
# WRONG
rg "expect\(" src/ui/page_blocks/dashboard/team/__tests__/TeamContainer.spec.tsx | wc -l

# RIGHT
npx tsx scripts/AST/ast-test-analysis.ts src/ui/page_blocks/dashboard/team/__tests__/ --kind ASSERTION_CALL --pretty
```

---

## 6. Side Effects and Storage

### "Any direct localStorage/sessionStorage access?"

```bash
# WRONG
rg "localStorage\|sessionStorage" src/ui/ --type ts

# RIGHT
npx tsx scripts/AST/ast-storage-access.ts src/ui/ --kind DIRECT_STORAGE_CALL --pretty
```

### "Any console.log left in production code?"

```bash
# WRONG
rg "console\." src/ui/ --type ts

# RIGHT
npx tsx scripts/AST/ast-side-effects.ts src/ui/ --kind CONSOLE_CALL --pretty
```

### "Any setTimeout/setInterval usage?"

```bash
# WRONG
rg "setTimeout\|setInterval" src/ --type ts

# RIGHT
npx tsx scripts/AST/ast-side-effects.ts src/ --kind TIMER_CALL --pretty
```

---

## 7. Data Layer and Service Hooks

### "What query hooks exist in this area?"

```bash
# WRONG
rg "useQuery\|useMutation" src/ui/services/hooks/ --type ts -l

# RIGHT
npx tsx scripts/AST/ast-data-layer.ts src/ui/services/hooks/ --pretty
# Returns QUERY_HOOK_DEFINITION, MUTATION_HOOK_DEFINITION, FETCH_API_CALL, QUERY_KEY_FACTORY
```

### "What API endpoints does this service hook call?"

```bash
# WRONG
rg "fetchApi\|/api/" src/ui/services/hooks/queries/useTeamsListQuery.ts

# RIGHT
npx tsx scripts/AST/ast-data-layer.ts src/ui/services/hooks/queries/useTeamsListQuery.ts --kind FETCH_API_CALL --pretty
```

---

## 8. Feature Flags

### "Where is feature flag X used?"

```bash
# WRONG
rg "myFeatureFlag" src/ --type ts

# RIGHT
npx tsx scripts/AST/ast-feature-flags.ts src/ --pretty
# Returns FLAG_HOOK_CALL, FLAG_READ, PAGE_GUARD, CONDITIONAL_RENDER
# Filter to a specific flag via --kind or pipe through jq:
#   npx tsx scripts/AST/ast-feature-flags.ts src/ --kind FLAG_READ --pretty
#   npx tsx scripts/AST/ast-feature-flags.ts src/ | jq '[.[] | select(.evidence.flagName == "myFlag")]'
```

---

## 9. Authorization Patterns

### "Where are raw role checks outside canonical files?"

```bash
# WRONG
rg "roles.includes(Role." src/ --type ts
rg "=== Role\." src/ --type ts

# RIGHT
npx tsx scripts/AST/ast-authz-audit.ts src/ --pretty
# Returns RAW_ROLE_CHECK and RAW_ROLE_EQUALITY observations
```

---

## 10. Date Handling

### "Where is raw Date used instead of Temporal?"

```bash
# WRONG
rg "new Date\(\)" src/ --type ts
rg "Date.now\(\)" src/ --type ts

# RIGHT
npx tsx scripts/AST/ast-date-handling.ts src/ --pretty
# For a summary ratio (raw vs proper):
npx tsx scripts/AST/ast-date-handling.ts src/ --summary
```

---

## 11. Display Conventions

### "Where is toFixed used instead of formatNumber?"

```bash
# WRONG
rg "\.toFixed\(" src/ --type ts

# RIGHT
npx tsx scripts/AST/ast-number-format.ts src/ --kind RAW_TO_FIXED --pretty
```

### "Where are wrong null placeholders used?"

```bash
# WRONG
rg "N/A\|'--'" src/ --type ts

# RIGHT
npx tsx scripts/AST/ast-null-display.ts src/ --pretty
```

---

## 12. Branded Types

### "Where are bare string IDs used instead of branded types?"

```bash
# WRONG
rg "userId: string" src/ --type ts
sg -p 'userId: string' src/

# RIGHT
npx tsx scripts/AST/ast-branded-check.ts src/ --pretty
# Returns UNBRANDED_ID_FIELD and UNBRANDED_PARAM observations
```

---

## 13. Field/Property References

### "Where is field X referenced across the codebase?"

```bash
# WRONG
rg "active_time_ms" src/ --type ts

# RIGHT
npx tsx scripts/AST/ast-field-refs.ts src/ --field active_time_ms --pretty
```

Finds object property access, destructuring, type definitions, and
string literal references -- not just text matches.

---

## 14. BFF Handler Structure

### "Which API handlers have inline logic exceeding thresholds?"

```bash
# WRONG
rg "req\.body\|req\.query\|res\.status" src/pages/api/users/ --type ts -c  # counts access, not logic depth
rg "switch.*req\.method" src/pages/api/ --type ts -l  # finds multi-method but misses single-method bloat

# RIGHT
npx tsx scripts/AST/ast-handler-structure.ts src/pages/api/users/ --pretty
# Returns HANDLER_INLINE_LOGIC and HANDLER_MULTI_METHOD observations
```

---

## 15. JSX Template Complexity

### "Where are deeply nested ternaries in JSX?"

```bash
# WRONG
rg "? <" src/ui/page_blocks/dashboard/ --type ts  # finds ternaries but can't measure nesting depth
sg -p '$A ? $B : $C ? $D : $E' src/  # structural but misses JSX-specific context

# RIGHT
npx tsx scripts/AST/ast-jsx-analysis.ts src/ui/page_blocks/dashboard/ --kind JSX_TERNARY_CHAIN --pretty
```

Reports depth, whether the chain is inside a JSX return, and whether it
exceeds the configured threshold.

### "Where are inline event handlers in JSX?"

```bash
# WRONG
rg "onClick=\{[^}]*=>" src/ui/ --type ts  # misses multi-line handlers, matches non-JSX

# RIGHT
npx tsx scripts/AST/ast-jsx-analysis.ts src/ --kind JSX_INLINE_HANDLER --pretty
```

### "Is this JSX complex enough to extract?"

Use the interpreter over raw JSX observations:

```bash
npx tsx scripts/AST/ast-interpret-template.ts src/ui/page_blocks/dashboard/team/ --pretty
# EXTRACTION_CANDIDATE: JSX block with enough complexity to warrant extraction
# COMPLEXITY_HOTSPOT: template exceeds thresholds but extraction may not help
```

---

## 16. Environment Variables

### "Where is process.env accessed directly?"

```bash
# WRONG
rg "process\.env" src/ --type ts

# RIGHT
npx tsx scripts/AST/ast-env-access.ts src/ --kind PROCESS_ENV_ACCESS --pretty
```

---

## 17. Error Handling Coverage

### "Which containers don't handle query errors?"

```bash
# WRONG
rg "isError" src/ui/page_blocks/dashboard/ --type ts -l  # presence != handling

# RIGHT
npx tsx scripts/AST/ast-error-coverage.ts src/ui/page_blocks/dashboard/ --kind QUERY_ERROR_UNHANDLED --pretty
```

---

## 18. Behavioral Concern Matrix

### "Which containers are missing loading/error/empty states?"

```bash
# WRONG
rg "isLoading\|isPending" src/ui/page_blocks/dashboard/ --type ts -l  # presence != completeness

# RIGHT
npx tsx scripts/AST/ast-concern-matrix.ts src/ui/page_blocks/dashboard/ --pretty
# Returns CONTAINER_HANDLES_* and CONTAINER_MISSING_* observations
# Count mode for quick triage:
npx tsx scripts/AST/ast-concern-matrix.ts src/ui/page_blocks/dashboard/ --count
```

---

## 19. Config Lookups

### "What are the PRIORITY_RULES for finding assignment?"

```bash
# WRONG
rg "PRIORITY_RULES" scripts/AST/ast-config.ts
grep -A 200 'PRIORITY_RULES' scripts/AST/ast-config.ts | head -250
cat scripts/AST/ast-config.ts | grep -A 200 'PRIORITY_RULES'

# RIGHT
npx tsx scripts/AST/ast-config.ts --dump-priority-rules
```

---

## 20. Skill File Analysis

### "Are there stale paths or broken cross-refs in a skill?"

```bash
# WRONG
rg "tsc --noEmit" .claude/skills/
rg "src/.*\.ts" .claude/skills/audit-react-feature/SKILL.md

# RIGHT
npx tsx scripts/AST/ast-skill-analysis.ts .claude/skills/audit-react-feature/SKILL.md --pretty
```

---

## 21. Export Surface Extraction

### "What does this file export?"

```bash
# WRONG
rg "^export " src/shared/utils/date/formatDate.ts
grep -n "export function\|export const\|export type" src/shared/utils/date/formatDate.ts

# RIGHT
npx tsx scripts/AST/ast-export-surface.ts src/shared/utils/date/formatDate.ts --pretty
```

Works on isolated files and git refs -- useful for provenance auditing
after large refactors where files may have been deleted.

---

## 22. BFF Route Gaps

### "Which API endpoints are stubbed or missing?"

```bash
# WRONG
diff <(ls src/pages/api/mock/**/*.ts) <(ls src/pages/api/users/**/*.ts)  # wrong structure, misses stubs

# RIGHT
npx tsx scripts/AST/ast-bff-gaps.ts --pretty
# Returns BFF_STUB_ROUTE, MOCK_ROUTE, BFF_MISSING_ROUTE, QUERY_HOOK_BFF_GAP
```

Compares real BFF handlers against mock handlers and service hook
expectations. Finds endpoints that exist in mock but have no real
implementation, and service hooks that call endpoints with no handler.

---

## 23. Refactor Intent Verification

### "Did this refactor accidentally drop behavior?"

```bash
# WRONG
diff -r before/ after/  # text diff, no semantic understanding

# RIGHT
npx tsx scripts/AST/ast-refactor-intent.ts --before src/ui/page_blocks/dashboard/team/ --after src/ui/page_blocks/dashboard/team/ --pretty
```

Compares observation sets before and after a refactor. Use the
interpreter for scored assessment:

```bash
npx tsx scripts/AST/ast-interpret-refactor-intent.ts --before <dir> --after <dir> --pretty
# INTENT_SIGNAL_PAIR observations show matched/dropped/added signals
```

---

## 24. Peer Dependency Satisfaction

### "Are peer dependencies satisfied?"

```bash
# WRONG
rg "peerDependencies" node_modules/*/package.json  # slow, incomplete, misses version ranges

# RIGHT
npx tsx scripts/AST/ast-peer-deps.ts --pretty
# Returns PEER_DEP_SATISFIED, PEER_DEP_VIOLATED, PEER_DEP_OPTIONAL_MISSING
```

---

## 25. Interpreter Recipes

Interpreters consume observations and emit classified assessments.
Use them when you need a judgment call, not just a structural fact.

### "Is this export actually dead or just indirectly used?"

```bash
npx tsx scripts/AST/ast-interpret-dead-code.ts src/ui/page_blocks/dashboard/ --pretty
# DEAD_EXPORT: zero consumers in the import graph
# POSSIBLY_DEAD_EXPORT: only consumed via barrel re-exports
# DEAD_BARREL_REEXPORT: barrel re-exports something nobody imports
# CIRCULAR_DEPENDENCY: import cycle detected
```

### "What role does this hook play?"

```bash
npx tsx scripts/AST/ast-interpret-hooks.ts src/ui/page_blocks/dashboard/team/ --pretty
# LIKELY_SERVICE_HOOK: data-fetching (useQuery/useMutation wrapper)
# LIKELY_CONTEXT_HOOK: reads from a React context
# LIKELY_AMBIENT_HOOK: DOM/UI utility (useBreakpoints, usePagination)
# LIKELY_STATE_HOOK: local state management
# UNKNOWN_HOOK: could not classify -- needs manual review
```

### "Does this number/null display follow conventions?"

```bash
npx tsx scripts/AST/ast-interpret-display-format.ts src/ui/page_blocks/dashboard/ --pretty
# Consumes ast-number-format + ast-null-display observations
# WRONG_PLACEHOLDER, MISSING_PLACEHOLDER, FALSY_COALESCE_NUMERIC,
# RAW_FORMAT_BYPASS, PERCENTAGE_PRECISION_MISMATCH, ZERO_NULL_CONFLATION
```

### "Is this orchestration plan structurally sound?"

```bash
npx tsx scripts/AST/ast-interpret-plan-audit.ts ~/plans/my-plan.md --pretty
# CERTIFIED: plan passes all structural checks
# BLOCKED_PREFLIGHT: plan has critical deficiencies
# PROMPT_DEFICIENCY, AGGREGATION_RISK, etc.
```

### "Do Playwright spec pairs have matching coverage?"

```bash
npx tsx scripts/AST/ast-interpret-pw-test-parity.ts integration/tests/ --pretty
# Matches spec pairs and compares assertion coverage, route intercepts, POM usage
```

### "Do Vitest spec pairs have matching coverage?"

```bash
npx tsx scripts/AST/ast-interpret-vitest-parity.ts src/ui/page_blocks/dashboard/ --pretty
# PARITY: tests match across spec pairs
# REDUCED: target spec has fewer assertions than source
# EXPANDED: target spec has more coverage
# NOT_PORTED: test exists in source but not in target
```

### "Does this skill file have convention drift?"

```bash
npx tsx scripts/AST/ast-interpret-skill-quality.ts .claude/skills/audit-react-feature/SKILL.md --pretty
# STALE_FILE_PATH, STALE_COMMAND, BROKEN_CROSS_REF, CONVENTION_DRIFT, CONVENTION_ALIGNED
```

---

## 26. File Inventory (Acceptable grep usage)

Counting files by directory for planning purposes is acceptable with
`find` or `ls` -- no AST tool covers this because it is not a source
analysis query.

```bash
# OK -- not a tool hierarchy violation
find src/ui/page_blocks/dashboard/systems -name '*.ts' -o -name '*.tsx' | grep -v __tests__ | wc -l
ls src/ui/page_blocks/dashboard/ | wc -l
```

---

## 27. Non-code Files (Acceptable grep usage)

Grep/rg on non-TypeScript files (markdown, JSON, SQL, YAML, SKILL.md
content) is acceptable. The tool hierarchy applies only to TS/TSX
source in `src/`, `integration/`, and `scripts/`.

```bash
# OK -- searching docs, not source
rg "findings.yaml" ~/audits/CLAUDE.md
rg "merge freeze" ~/plans/
grep -n "Last reviewed" ~/plans/KNOWN-DEBT-AND-DECISIONS.md
```

---

## Quick Reference Table

### Observation tools

| Question | Tool | Flag/Mode |
|---|---|---|
| Who imports symbol X? | `ast-imports` | `--symbol <name>` |
| Who consumes file X? | `ast-imports` | `--consumers <file>` |
| Circular dependencies? | `ast-imports` | `--kind CIRCULAR_DEPENDENCY` |
| Dead exports? | `ast-imports` | `--kind DEAD_EXPORT_CANDIDATE` |
| What does file X export? | `ast-export-surface` | (default) |
| Cyclomatic complexity? | `ast-complexity` | (default) |
| `as any` / `as unknown`? | `ast-type-safety` | `--kind AS_ANY_CAST` |
| Non-null assertions? | `ast-type-safety` | `--kind NON_NULL_ASSERTION` |
| Hook calls in component? | `ast-react-inventory` | `--kind HOOK_CALL` |
| useEffect count? | `ast-react-inventory` | `--kind EFFECT_LOCATION --count` |
| Test coverage gaps? | `ast-test-coverage` | (default) |
| Direct storage access? | `ast-storage-access` | `--kind DIRECT_STORAGE_CALL` |
| Console calls? | `ast-side-effects` | `--kind CONSOLE_CALL` |
| Timer calls? | `ast-side-effects` | `--kind TIMER_CALL` |
| Query hooks / endpoints? | `ast-data-layer` | (default) |
| Feature flag usage? | `ast-feature-flags` | `--kind FLAG_READ` for specific |
| Raw role checks? | `ast-authz-audit` | (default) |
| Raw Date usage? | `ast-date-handling` | `--summary` for ratio |
| Raw toFixed? | `ast-number-format` | `--kind RAW_TO_FIXED` |
| Wrong placeholders? | `ast-null-display` | (default) |
| Unbranded IDs? | `ast-branded-check` | (default) |
| Field references? | `ast-field-refs` | `--field <name>` |
| Handler inline logic? | `ast-handler-structure` | (default) |
| JSX ternary chains? | `ast-jsx-analysis` | `--kind JSX_TERNARY_CHAIN` |
| process.env access? | `ast-env-access` | `--kind PROCESS_ENV_ACCESS` |
| Missing error handling? | `ast-error-coverage` | `--kind QUERY_ERROR_UNHANDLED` |
| Missing loading/error? | `ast-concern-matrix` | `--count` for triage |
| BFF route gaps? | `ast-bff-gaps` | (default) |
| Peer dep violations? | `ast-peer-deps` | (default) |
| Mock type/target? | `ast-test-analysis` | `--kind MOCK_DECLARATION` |
| Priority rules? | `ast-config` | `--dump-priority-rules` |
| Stale skill paths? | `ast-skill-analysis` | (default) |

### Interpreters

| Question | Interpreter | Consumes |
|---|---|---|
| Effect classification? | `ast-interpret-effects` | ast-react-inventory |
| Container or component? | `ast-interpret-ownership` | ast-react-inventory |
| Hook role (service/context/ambient)? | `ast-interpret-hooks` | ast-react-inventory |
| Is export actually dead? | `ast-interpret-dead-code` | ast-imports |
| Mock violations? | `ast-interpret-test-quality` | ast-test-analysis |
| Test coverage priority? | `ast-interpret-test-coverage` | ast-test-coverage |
| JSX extraction candidate? | `ast-interpret-template` | ast-jsx-analysis |
| Display convention violations? | `ast-interpret-display-format` | ast-number-format, ast-null-display |
| Refactor preserved intent? | `ast-interpret-refactor-intent` | ast-refactor-intent |
| Plan structurally sound? | `ast-interpret-plan-audit` | ast-plan-audit |
| Skill convention drift? | `ast-interpret-skill-quality` | ast-skill-analysis |
| PW spec parity? | `ast-interpret-pw-test-parity` | ast-pw-test-parity |
| Vitest spec parity? | `ast-interpret-vitest-parity` | ast-vitest-parity |
