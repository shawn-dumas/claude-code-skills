# Audit: [Name]

> Category: audit
> Trigger: `/audit-[name] <target-path>`

[One-sentence description of what this skill audits and what principles
it scores against.]

**This skill is read-only. It does not modify any files.**

<!-- role: reference -->
## Background

[Principles being enforced. Reference the relevant section of
README.md. Include a lookup table mapping principle numbers to
violation signal names if applicable.]

<!-- role: workflow -->
## Step 0: Run AST analysis tools

```bash
# Adjust tools to the domain
npx tsx scripts/AST/ast-complexity.ts <target> --pretty
npx tsx scripts/AST/ast-type-safety.ts <target> --pretty
npx tsx scripts/AST/ast-imports.ts <target> --pretty
```

<!-- role: reference -->
### Using observations and assessments

[Map AST observation kinds and assessment kinds to the audit criteria.
Explain which tool output feeds which audit step.]

<!-- role: guidance -->
## Report policy

[Rules for tagging findings: AST-confirmed criteria, severity bumping,
delete thresholds, manual review triggers.]

<!-- role: detect -->
## Step 1: [First audit criterion]

[What to look for. What constitutes a violation. Scoring impact.]

<!-- role: detect -->
## Step 2: [Second audit criterion]

[What to look for. What constitutes a violation. Scoring impact.]

<!-- role: detect -->
## Step N: [Nth audit criterion]

[Continue for each principle or criterion being audited.]

<!-- role: cleanup -->
## Cleanup patterns

[If the audit checks for test cleanup compliance, list the required
cleanup patterns here. This section is only needed for test-related
audit skills.]

| Trigger pattern | Required cleanup | Location |
| --------------- | ---------------- | -------- |
| `X.setItem()`   | `X.clear()`      | afterEach |

<!-- role: detect -->
## Coverage gap detection

[Check for untested files, missing API coverage, or other structural
gaps that the audit should flag.]

<!-- role: emit -->
## Produce the audit report

[Output format template. The report is the only "emitted" artifact
from an audit skill.]

```
## Audit Report: [target]

### Scorecard
| Principle | Score | Findings |
| --------- | ----- | -------- |

### Violation inventory
[per-file findings]

### Migration priority
[ordered list of recommended fixes]
```

<!-- role: workflow -->
## Interpreter calibration gate

[If the audit uses AST interpreters, describe the feedback fixture
creation process for misclassifications.]
