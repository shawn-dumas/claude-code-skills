# Ground Truth Fixtures

Synthetic and real fixture pairs for calibrating AST interpreter accuracy.

## Directory structure

Each fixture lives in its own directory. The `tool` field in `manifest.json`
tells the calibration skill which interpreter to run:

- `intent` -- runs `analyzeRefactorIntent()` + `interpretRefactorIntent()`
- `parity` -- runs `analyzeTestParity()` + `interpretTestParity()`

## Naming convention

- `synth-intent-NN-description/` -- synthetic intent matcher fixtures
- `synth-parity-NN-description/` -- synthetic parity tool fixtures
- `git-intent-NN-description/` -- git-history intent fixtures (from real refactoring commits)
- `git-parity-NN-description/` -- git-history parity fixtures (from real test migration between QA and integration suites)
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

## Design rules

- Each fixture file must be under 40 lines.
- Intent fixtures must produce at least 3 different observation kinds.
- Parity fixtures must produce at least 2 of the 4 signal types
  (assertions, route intercepts, navigations, POM usages).
- Classifications are written by hand. Never run the matcher and copy output.

For the full authoring guide (evaluation pipeline, cross-file factory setup,
common pitfalls), see `../docs/ast-fixture-authoring.md`.
