# Ground Truth Fixtures

Synthetic and real fixture pairs for calibrating AST interpreter accuracy.

## Directory structure

Each fixture lives in its own directory. The `tool` field in `manifest.json`
tells the calibration skill which interpreter to run:

- `intent` -- runs `analyzeRefactorIntent()` + `interpretRefactorIntent()`
- `parity` -- runs `analyzeTestParity()` + `interpretTestParity()`
- `vitest-parity` -- runs `analyzeVitestParity()` + `interpretVitestParity()`
- `effects` -- runs `analyzeReactFile()` + `interpretEffects()`
- `hooks` -- runs `analyzeReactFile()` + `interpretHooks()`
- `ownership` -- runs `analyzeReactFile()` + `interpretHooks()` + `interpretOwnership()`
- `template` -- runs `extractJsxObservations()` + `interpretTemplate()`
- `test-quality` -- runs `analyzeTestFile()` + `interpretTestQuality()`
- `dead-code` -- runs `buildDependencyGraph()` + `extractImportObservations()` + `interpretDeadCode()`

## Naming convention

- `synth-intent-NN-description/` -- synthetic intent matcher fixtures
- `synth-parity-NN-description/` -- synthetic PW parity tool fixtures
- `synth-vitest-parity-NN-description/` -- synthetic Vitest parity tool fixtures
- `synth-effects-NN-description/` -- synthetic effects interpreter fixtures
- `synth-hooks-NN-description/` -- synthetic hooks interpreter fixtures
- `synth-ownership-NN-description/` -- synthetic ownership interpreter fixtures
- `synth-template-NN-description/` -- synthetic template interpreter fixtures
- `git-intent-NN-description/` -- git-history intent fixtures (from real refactoring commits)
- `git-parity-NN-description/` -- git-history parity fixtures (from real test migration between QA and integration suites)
- `git-effects-NN-description/` -- git-history effects fixtures (from real useEffect patterns)
- `feedback-YYYY-MM-DD-description/` -- feedback fixtures created by refactor skills on misclassification

## Manifest format

### Intent manifests

```json
{
  "tool": "intent",
  "created": "2026-03-14",
  "source": "synthetic",
  "refactorType": "component",
  "beforeFiles": ["before-UserPanel.tsx"],
  "afterFiles": ["after-UserPanelContainer.tsx", "after-UserPanelBlock.tsx"],
  "expectedClassifications": [
    {
      "kind": "HOOK_CALL",
      "evidence": { "hookName": "useAuthState" },
      "expectedClassification": "PRESERVED",
      "notes": "useAuthState moved to container"
    }
  ],
  "status": "pending"
}
```

### Parity manifests

```json
{
  "tool": "parity",
  "created": "2026-03-14",
  "source": "synthetic",
  "sourceFiles": ["source-mockDataUsers.spec.ts"],
  "targetFiles": ["target-users.spec.ts"],
  "helperFiles": ["target-helper-usersPage.ts"],
  "expectedClassifications": [
    {
      "testName": "displays user email",
      "expectedStatus": "PARITY",
      "notes": "inline assertions in source, POM delegation in target"
    }
  ],
  "status": "pending"
}
```

### Vitest parity manifests

```json
{
  "tool": "vitest-parity",
  "created": "2026-03-15",
  "source": "synthetic",
  "sourceFiles": ["source-useTeamData.spec.ts"],
  "targetFiles": ["target-useTeamData.spec.ts"],
  "expectedClassifications": [
    {
      "testName": "returns team members",
      "expectedStatus": "PARITY",
      "notes": "Target has 3 assertions vs source 2 -- within parity threshold"
    }
  ],
  "status": "pending"
}
```

### Effects manifests (entry-based)

```json
{
  "tool": "effects",
  "created": "2026-03-16",
  "source": "synthetic",
  "files": ["component.tsx"],
  "expectedClassifications": [
    {
      "file": "component.tsx",
      "line": 12,
      "symbol": "MyComponent",
      "expectedKind": "DERIVED_STATE",
      "notes": "fetch + setState -- classic data fetching in effect anti-pattern"
    }
  ],
  "status": "pending"
}
```

### Hooks manifests (entry-based)

Same entry-based format as effects. The `symbol` field is the hook name.
Fixtures must include realistic import statements (e.g., from
`@/services/hooks/`, `@/providers/`, `@/shared/hooks/`) because the hooks
interpreter classifies by import path as well as hook name.

```json
{
  "tool": "hooks",
  "created": "2026-03-16",
  "source": "synthetic",
  "files": ["component.tsx"],
  "expectedClassifications": [
    {
      "file": "component.tsx",
      "line": 17,
      "symbol": "useTeamQuery",
      "expectedKind": "LIKELY_SERVICE_HOOK",
      "notes": "Imported from services/hooks/queries/ path"
    }
  ],
  "status": "pending"
}
```

### Template manifests (entry-based)

Same entry-based format as effects. The `symbol` field is the component
name. The evaluation harness chains `extractJsxObservations` ->
`interpretTemplate`. Assessment kinds: `EXTRACTION_CANDIDATE`,
`COMPLEXITY_HOTSPOT`. EXTRACTION_CANDIDATE fires at > 100 line returns,
2+ deep ternaries (depth >= 2), or IIFE. COMPLEXITY_HOTSPOT fires at
3+ distinct JSX observation kinds (excluding JSX_RETURN_BLOCK), or inline
handler with 4+ statements. Fixture files for EXTRACTION_CANDIDATE
may exceed the 40-line limit since the trigger requires > 100 lines
of JSX return.

```json
{
  "tool": "template",
  "created": "2026-03-16",
  "source": "synthetic",
  "files": ["long-return.tsx", "clean-component.tsx"],
  "expectedClassifications": [
    {
      "file": "long-return.tsx",
      "line": 18,
      "symbol": "LongComponent",
      "expectedKind": "EXTRACTION_CANDIDATE",
      "notes": "160-line return block triggers high confidence extraction"
    }
  ],
  "status": "pending"
}
```

### Ownership manifests (entry-based)

Same entry-based format as effects. The `symbol` field is the component
name. The evaluation harness chains `analyzeReactFile` -> `interpretHooks`
-> `interpretOwnership`, so fixtures must include realistic import paths
for hooks to classify correctly (service hooks from `@/services/hooks/`,
context hooks from `@/providers/`). Assessment kinds: `CONTAINER`,
`DDAU_COMPONENT`, `LAYOUT_SHELL`, `LEAF_VIOLATION`, `AMBIGUOUS`.

```json
{
  "tool": "ownership",
  "created": "2026-03-16",
  "source": "synthetic",
  "files": ["TeamContainer.tsx"],
  "expectedClassifications": [
    {
      "file": "TeamContainer.tsx",
      "line": 10,
      "symbol": "TeamContainer",
      "expectedKind": "CONTAINER",
      "notes": "3 signals: service hook, context hook, Container suffix"
    }
  ],
  "status": "pending"
}
```

## Design rules

- Each fixture file must be under 40 lines.
- Intent fixtures must produce at least 3 different observation kinds.
- Parity fixtures must produce at least 2 of the 4 signal types
  (assertions, route intercepts, navigations, POM usages).
- Classifications are written by hand. Never run the matcher and copy output.
- **Do not fix interpreters during fixture authoring.** If a fixture
  reveals a misclassification, note it in the cleanup file and move on.
  The `/calibrate-ast-interpreter` skill addresses misclassifications in
  batch (3+ pending fixtures). Fixing in-flight conflates measurement
  with optimization, bypasses the skill's diagnostic-first workflow, and
  breaks commit atomicity for bisect. See `../docs/ast-calibration.md`
  (Ground rules, rule 2) for the full rationale.

For the full authoring guide (evaluation pipeline, cross-file factory setup,
common pitfalls), see `../docs/ast-fixture-authoring.md`.
