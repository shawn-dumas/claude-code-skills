# Build Manifests

The **build manifest** is the input contract for Semi-Closed build-\*
skills: the tool emits a structural snapshot of a production file, and
the consuming skill generates code that satisfies the snapshot. The
counterpart is the **build output validator** (`ast-validate-build-output`),
which enforces gates on the generated output.

Together they encode the Semi-Closed pattern: agent generates, tools
constrain input and validate output. This is the middle tier of the
three-tier taxonomy for build-\* skills (Closed / Semi-Closed / Open) --
the input is deterministic and the output is gate-checked, but the
generative step in the middle remains agent-driven.

## Shape

Emitted by `scripts/AST/ast-build-manifest.ts`. Reference implementation:
`BuildManifest` interface in that file.

```typescript
interface BuildManifest {
  file: string;                        // relative path from PROJECT_ROOT
  structuralKind: 'component' | 'hook' | 'mixed' | 'utility';
  exports: {
    name: string;                      // exported identifier
    kind: string;                      // TypeScript SyntaxKind name (e.g., 'VariableDeclaration')
    line: number;                      // 1-indexed line in production file
  }[];
  primaryComponent?: {                 // present when structuralKind != 'hook' && != 'utility'
    name: string;
    line: number;
    props: PropField[];                // see types.ts for PropField shape
  };
  hookCalls: HookCall[];               // see types.ts for HookCall shape (from ast-react-inventory)
  dataLayer: {
    queryHooks: { name: string; line: number }[];
    mutationHooks: { name: string; line: number }[];
    fetchApiCalls: { endpoint: string; line: number }[];
  };
  imports: {
    module: string;                    // specifier as written in source
    named: string[];                   // named import identifiers
  }[];
}
```

## What the manifest is (and is not)

**The manifest is a structural fact collector.** It records what the
production file EXPORTS, what PROPS a component declares, what HOOKS a
file CALLS, and what DATA-LAYER APIs it invokes. Every field is
derivable from the AST without interpretation.

**The manifest is NOT an ownership classifier.** It does not decide
whether a file is a `CONTAINER` or a `DDAU_COMPONENT` or a
`LEAF_VIOLATION`. That judgment belongs to `ast-interpret-ownership`,
which consumes hook assessments, side-effect observations, and repo
conventions from `ast-config.ts`.

The manifest's `structuralKind` is a coarse bucket (component / hook /
mixed / utility) based on file-path and inventory heuristics. It is
useful for routing: skills use it to dispatch to unit-vs-integration
test templates. It is not a substitute for the ownership interpreter,
which a skill should still call when classification matters.

## Consuming the manifest

Skills invoke the manifest tool once and parse the JSON output. The
manifest fields replace what Step 1 of `build-react-test` currently
reads via ad-hoc file inventory.

```bash
npx tsx scripts/AST/ast-build-manifest.ts src/path/to/Component.tsx --pretty
```

Programmatic use:

```typescript
import { buildManifest } from './ast-build-manifest';

const manifest = buildManifest('src/path/to/Component.tsx');
if (manifest.structuralKind === 'component' && manifest.primaryComponent) {
  // Use manifest.primaryComponent.props to generate prop-driven tests
}
```

## Companion: the validator

After the skill generates a spec file, the validator checks it against
contract-first testing gates:

```bash
npx tsx scripts/AST/ast-validate-build-output.ts <path-to-spec> --pretty
```

Gates (all must pass or exit code is non-zero):

- `no-internal-mocking` -- no `MOCK_INTERNAL_VIOLATION` assessments
- `type-safe-data-sourcing` -- no `DATA_SOURCING_VIOLATION` assessments
- `cleanup-complete` -- no `CLEANUP_INCOMPLETE` assessments
- `not-orphaned` -- the subject file exists (no `ORPHANED_TEST`)
- `user-visible-assertions-present` -- at least one `ASSERTION_USER_VISIBLE`

The gate list is encoded in `GATE_CONFIG` in
`scripts/AST/ast-validate-build-output.ts`. Adding a new gate means
adding a `TestQualityAssessmentKind` to the failing-kinds list or
adding a new aggregate check (like `user-visible-assertions-present`).

## Two-gate pipeline

The skill runs the manifest before generation and the validator after,
with the agent filling in the middle:

```
production file
    |
    v
ast-build-manifest  --> JSON manifest (input constraint)
    |
    v
agent generates spec file using manifest fields
    |
    v
ast-validate-build-output --> JSON report (output gate)
    |
    v
PASS: commit   FAIL: fix and re-validate
```

This is the Semi-Closed tier of the build-skill taxonomy. Closed tools
(barrels, query keys, fixture builders) run without the agent. Open
tools (complex components, business logic) run without gates. Semi-Closed
tools -- like `build-react-test` -- have both.

## Extension

A new build-\* skill joins the Semi-Closed tier by:

1. Consuming `ast-build-manifest` as its structural-input contract.
2. Running `ast-validate-build-output` (or a domain-specific validator)
   as its output gate.
3. Documenting its tier in the skill's frontmatter (`tier: semi-closed`).

If a skill's output cannot be validated by the test-quality
interpreter, a new validator can be built against a different
interpreter (e.g., `ast-interpret-hooks` for hook quality,
`ast-interpret-ownership` for ownership violations in generated
containers). The `ast-validate-build-output` tool is the reference
implementation; subsequent validators follow the same gate-report
shape.
