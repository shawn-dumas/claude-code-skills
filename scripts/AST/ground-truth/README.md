# Ground Truth Files

Ground truth files for measuring AST interpreter accuracy. Each file
contains manually verified assessment expectations for a specific
interpreter.

## Format

Each file is a JSON object with this structure:

```json
{
  "interpreter": "ast-interpret-effects",
  "lastReviewed": "2026-03-14",
  "entries": [
    {
      "file": "src/ui/page_blocks/dashboard/team/TeamContainer.tsx",
      "line": 42,
      "expectedKind": "DERIVED_STATE",
      "symbol": "TeamContainer",
      "note": "useEffect syncs teamId prop to local state -- classic derived state"
    }
  ]
}
```

### Fields

| Field          | Required | Description                                       |
| -------------- | -------- | ------------------------------------------------- |
| `interpreter`  | yes      | Interpreter module name (without `.ts` extension) |
| `lastReviewed` | yes      | ISO date of last manual review                    |
| `entries`      | yes      | Array of ground truth entries                     |

### Entry fields

| Field          | Required | Description                                                           |
| -------------- | -------- | --------------------------------------------------------------------- |
| `file`         | yes      | Relative file path from project root                                  |
| `line`         | yes      | Line number of the assessment subject                                 |
| `expectedKind` | yes      | Assessment kind the interpreter should produce                        |
| `symbol`       | no       | Symbol name for disambiguation when multiple assessments share a line |
| `note`         | no       | Human-readable rationale for the ground truth decision                |

## Naming convention

`<interpreter-name>.json` -- e.g., `ast-interpret-effects.json`.

## Accuracy evaluation

Accuracy is measured by `interpreter-accuracy.spec.ts`, which loads all
fixture pairs, runs each interpreter, and asserts accuracy >= threshold.
This runs as a vitest spec so CI catches regressions from interpreter or
observation tool changes.

Metrics tracked per fixture and in aggregate:

- **True positives (TP)**: classification matches expected at same signal
- **False positives (FP)**: classification produced but not expected
- **False negatives (FN)**: expected classification not produced
- Per-fixture minimum: 50%. Aggregate minimum: 60%.

## Guidelines

1. Ground truth entries should be manually verified against the source code.
2. Review and update entries when the source code changes.
3. Use the `note` field to document why the expected kind was chosen.
4. Keep entries focused -- a ground truth file does not need to cover every
   assessment in the codebase, just a representative sample.
5. Ground truth files are NOT checked in during initial setup. Phase 8
   of the enhancement plan handles population.

## Fixture-based ground truth

For the intent matcher and parity tool, ground truth is managed as
fixture directories in `fixtures/` rather than JSON entry files. Each
fixture contains before/after source files and a `manifest.json` with
expected classifications.

- `fixtures/README.md` -- manifest format and design rules
- `docs/ast-fixture-authoring.md` -- full authoring guide (relative to `scripts/AST/`)
- `docs/ast-calibration.md` -- accuracy baselines and calibration history (relative to `scripts/AST/`)
