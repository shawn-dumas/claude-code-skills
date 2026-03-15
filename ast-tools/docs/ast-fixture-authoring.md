# AST Fixture Authoring Guide

How to create ground truth fixtures for calibrating the AST parity and
intent interpreters. All fixtures live in `scripts/AST/ground-truth/fixtures/`.

## Naming convention

| Prefix      | Source            | Example                              |
| ----------- | ----------------- | ------------------------------------ |
| `synth-*`   | Hand-written code | `synth-parity-01-inline-vs-pom`      |
| `git-*`     | Real git history  | `git-parity-02-bpo-factory`          |
| `feedback-*`| Skill misclassification | `feedback-2026-03-14-hook-swap` |

Format: `{source}-{tool}-{NN}-{description}/`

- `tool` is `intent` or `parity`
- `NN` is a zero-padded sequence number within its source+tool group

## Directory contents

Each fixture directory contains:

- `manifest.json` -- declares files, tool type, and expected classifications
- Source file(s) -- the "before" (intent) or QA spec (parity)
- Target file(s) -- the "after" (intent) or integration spec (parity)
- Helper file(s) -- POM classes, utility files, or factory files used by targets

## Manifest format

### Parity manifest

```json
{
  "tool": "parity",
  "created": "2026-03-14",
  "source": "git-history",
  "gitSourceBranch": "production",
  "gitSourcePath": "e2e/tests/bpo.spec.ts",
  "gitTargetBranch": "sd/productionize",
  "gitTargetPath": "integration/tests/bpo.spec.ts",
  "sourceFiles": ["source-bpo.spec.ts"],
  "targetFiles": ["target-bpo.spec.ts"],
  "helperFiles": ["settings-crud.factory.ts"],
  "expectedClassifications": [
    {
      "testName": "Create BPO, Delete BPO",
      "expectedStatus": "PARITY",
      "notes": "Matches factory-generated 'Create BPO, delete BPO'"
    }
  ],
  "status": "pending"
}
```

- `testName` must match a **source** test name exactly
- `expectedStatus` is one of: `PARITY`, `EXPANDED`, `REDUCED`, `NOT_PORTED`
- `git*` fields are metadata for provenance tracking (not used by the test)

### Intent manifest

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

## Design rules

1. Each fixture file must be under **40 lines**.
2. Intent fixtures must produce at least **3 different observation kinds**.
3. Parity fixtures must produce at least **2 of the 4 signal types**
   (assertions, route intercepts, navigations, POM usages).
4. **Write classifications by hand.** Never run the matcher and copy output.
   If the tool disagrees with your classification, decide which is correct.

## Evaluation pipeline

The accuracy test (`interpreter-accuracy.spec.ts`) runs each fixture
through this sequence:

### Step 1: Write all files to temp directory

All source, target, and helper files are written to the temp directory
**before** any analysis begins. This is critical for cross-file factory
resolution -- the factory file must exist on disk when `analyzeTestParity`
processes the spec that imports it.

### Step 2: Build inventories

- Source inventories: `buildInventoryFromFile()` on each source file
- Target inventories: `buildInventoryFromFile()` on each target file

### Step 3: Build helper index

Helper files are analyzed via `analyzeHelperFile()` and assembled into a
`PwHelperIndex` with a `lookup` map from `qualifiedName --> assertionCount`.

### Step 4: Build file mapping

Index-based: `sourceFiles[0]` maps to `targetFiles[0]`, etc. Both arrays
must have the same length.

### Step 5: Run interpreter

`interpretTestParity(sourceInventories, targetInventories, fileMapping, { targetHelpers })`

### Step 6: Evaluate classifications

For each expected classification, the test finds the matching `testMatch`
by `sourceTest === expected.testName` and compares the status. Results
are logged with similarity scores for debugging.

## Thresholds

| Scope       | Threshold | Meaning                                  |
| ----------- | --------- | ---------------------------------------- |
| Per fixture | 50%       | No single fixture may score below 50%    |
| Overall     | 60%       | Total correct / total expected >= 60%    |

## Cross-file factory fixtures

When a target spec imports a factory function from a separate file:

1. Name the factory file to match the import path. If the spec has
   `import { defineSettingsCrudTests } from './settings-crud.factory'`,
   the file must be named `settings-crud.factory.ts` (not
   `target-helper-settings-crud.factory.ts`).
2. List the factory file in `helperFiles`, not `targetFiles`. It should
   not be analyzed as a standalone spec.
3. The accuracy test writes all files to the same temp directory, so
   relative imports between them will resolve correctly.

## Common pitfalls

### Navigation overlap causing false matches

If source and target tests both navigate to `/signin`, that navigation
overlap contributes 0.15 to the composite similarity. Combined with even
minimal name overlap, this can push the score above the 0.15 match
threshold and create a false match. When the real QA spec hides navigation
inside utility functions, the fixture source should too -- use opaque
helper calls instead of explicit `page.goto()`.

### Weight skew from opaque helpers

Source tests using opaque utility functions produce near-zero weight
(locator calls, `click()`, `fill()`, and `waitFor()` are not extracted).
Target tests with inline assertions and route intercepts produce much
higher weight. If the tool does match them, the weight ratio will be >2.0,
giving `EXPANDED` when the behavioral intent is `NOT_PORTED`.

Fix: make the fixture source structurally faithful to the real spec. If
the real spec uses `signInAsONELOGINAdmin(page)`, use an opaque helper
call in the fixture too.

### Factory file as target vs helper

If the factory file is listed in `targetFiles`, it will be analyzed as a
standalone spec and produce an empty inventory (no top-level `test()` calls).
This creates a spurious entry in the interpreter output. List factory files
in `helperFiles` instead.

### Temp debug output in accuracy test

The accuracy test has conditional logging for wrong/missed classifications.
To force output for all fixtures (including passing ones), temporarily
change the logging condition. Revert before committing.
