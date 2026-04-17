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

Emitted by `scripts/AST/ast-build-manifest.ts`. The authoritative contract
is the exported Zod schema `BuildManifestSchema` in that file; the
`BuildManifest` TypeScript type is derived via `z.infer<typeof
BuildManifestSchema>`. The tool calls `BuildManifestSchema.safeParse(...)`
at its output boundary, so programmatic consumers receive a
runtime-validated manifest and CLI consumers that re-parse the JSON with
the same schema get the same guarantees.

Zod is intentional here and absent from other AST tools. This tool is
the only one whose output is a cross-skill contract consumed by generator
skills (`build-react-test` and future semi-closed `build-*`) across
process boundaries. Other AST tools emit observations to in-repo
interpreters that share the TS type system, so `readonly interface`
definitions in `types.ts` suffice. When a tool's output leaves the
process as JSON and becomes input to an agent that will re-read it,
runtime validation earns its keep.

```typescript
import { z } from 'zod';

export const BuildManifestSchema = z.object({
  file: z.string(),                                  // relative path from PROJECT_ROOT
  structuralKind: z.enum(['component', 'hook', 'mixed', 'utility']),
  exports: z.array(z.object({
    name: z.string(),                                // exported identifier
    kind: z.string(),                                // TypeScript SyntaxKind name (e.g., 'VariableDeclaration')
    line: z.number(),                                // 1-indexed line in production file
  })),
  primaryComponent: z.object({                       // present when structuralKind != 'hook' && != 'utility'
    name: z.string(),
    line: z.number(),
    props: z.array(PropFieldSchema),                 // shape matches ast-react-inventory's PropField
  }).optional(),
  hookCalls: z.array(HookCallSchema),                // shape matches ast-react-inventory's HookCall
  dataLayer: z.object({
    queryHooks: z.array(z.object({ name: z.string(), line: z.number() })),
    mutationHooks: z.array(z.object({ name: z.string(), line: z.number() })),
    fetchApiCalls: z.array(z.object({ endpoint: z.string(), line: z.number() })),
  }),
  imports: z.array(z.object({
    module: z.string(),                              // specifier as written in source
    named: z.array(z.string()),                      // named import identifiers
  })),
});

export type BuildManifest = z.infer<typeof BuildManifestSchema>;
```

Consumers that want the same runtime validation on the CLI side can
import the schema directly, keeping in mind that the module side-effect
loads `ts-morph` via the analyzer imports -- fine for test/build tooling
already running in that process, heavy for a thin wrapper that only
wants to re-parse JSON:

```typescript
import { BuildManifestSchema } from '../scripts/AST/ast-build-manifest';
const parsed = BuildManifestSchema.parse(JSON.parse(cliStdout).manifests[0]);
```

If a cheap schema-only import becomes a real consumer need, split
`BuildManifestSchema` into a standalone `ast-build-manifest.schema.ts`.
No consumers require that today.

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
