#!/usr/bin/env python3
"""
Plan audit calibration: per-check correlation analysis.

Assigns a friction grade (SMOOTH/ROUGH/HELLACIOUS) to each archived plan
based on execution metrics from historical-reference.md, then runs the
ast-plan-audit observation layer against each plan to get per-observation-kind
counts, and computes correlation between observation kinds and friction grades.

Friction grade criteria (from user-confirmed rubric):
  SMOOTH:  F 1-3, low user msgs, 0 compactions, 0 abandoned todos
  ROUGH:   F 4-6, or elevated user msgs, or 1-2 compactions
  HELLACIOUS: F 7+, or user msgs 100+, or many compactions, or significant abandoned todos

Plans with no execution data are graded UNKNOWN.
"""

import json
import subprocess
import sys
from pathlib import Path
from collections import Counter

# ---------------------------------------------------------------------------
# Friction grades (manually assigned from historical-reference.md)
# Grade values: 0=SMOOTH, 1=ROUGH, 2=HELLACIOUS, -1=UNKNOWN
# ---------------------------------------------------------------------------

FRICTION = {
    # === SMOOTH (F1-3, low friction, clean executions) ===
    "dev-panel.md": 0,  # F2, 0 failed tools, 0 compactions, 2h
    "delete-deprecated-pages.md": 0,  # F4 but 0 failed tools, 0 compactions, 1.25h
    "fe-to-bff-mapper-migration.md": 0,  # F3, 1 failed tool, 0 compactions, 2.5h
    "interpreter-calibration-infrastructure.md": 0,  # F2, 0 failed tools, 0 compactions, 4.5h
    "vitest-parity-tool.md": 0,  # F2, 1 failed tool, 0 compactions, 2.2h
    "ast-tool-enhancements.md": 0,  # F3, 0 failed tools, 0 compactions, 2.4h
    "git-protocol-hardening.md": 0,  # F2, 1 failed tool, 0 compactions, 16m
    "pm-recs-26-03-13-plan.md": 0,  # F2, ~2 failed, 0 compactions, 55m
    "bff-audit-fix-26-03-12-09-45-plan.md": 0,  # F3, 1 failed tool, 0 compactions, 49m (superseded by v2)
    "bff-audit-fix-v2-26-03-13-plan.md": 0,  # F3, 4 failed tools, 0 compactions, 84m
    "ast-tools-plan.md": 0,  # F3, ~0 failed, 0 compactions, 1h14m
    "ast-tools-cleanup-backlog.md": 0,  # F3, ~0 failed, 0 compactions, 67m
    "uf-phase-5-god-components.md": 0,  # F2, 1 tool error, ~2h
    "jsdoc-domain-types-plan.md": 0,  # F4, but ~2h single session
    # ddau-exception-elimination.md was a duplicate of uf-ddau-exception-elimination.md (moved to SMOOTH below)
    "fe-audit-fix-26-03-12-09-45-plan.md": 0,  # F4, 15 failed, but clean orchestration, 3.75h
    # === ROUGH (F4-6 or moderate friction) ===
    "bff-lift-and-shift.md": 1,  # F4, 17 failed, but 62 user msgs, 14 abandoned, 4 days
    "nga-systems-port.md": 1,  # F4, 0 failed tools BUT 60 user msgs, constant human steering
    "pw-parity-port-plan.md": 1,  # Playwright work, moderate
    "qa-test-migration.md": 1,  # F4, 13 failed, 75 user msgs, ~12h
    "orphan-backlog.md": 1,  # F3, 12 failed, 38 user msgs, ~16h
    "pw-test-gap-closure.md": 1,  # F4, 22 failed, 41 user msgs, 17.5h
    "audit-fix-26-03-10-15-40-plan.md": 1,  # F5, ~0 failed, ~3.5h, but P10+P12 partial
    "uf-phase-3-provider-stripping.md": 1,  # F5, 35 tool errors, 4h
    "uf-phase-2-service-hooks.md": 1,  # F6, 27 tool errors, 5h
    "uf-phase-6-type-safety.md": 1,  # F5, 33 tool errors, 10h
    "uf-phase-8-polish.md": 1,  # F6, 99 errors BUT 4h wall clock, 268 user msgs -> borderline
    "uf-flyout-coordination-elimination.md": 1,  # F3, but single execution
    "uf-ddau-exception-elimination.md": 0,  # F3, 3 tool errors, 12 user msgs, 0 compactions, ~6h -- SMOOTH by rubric
    "playwright-remediation.md": 1,  # F6, 80 failed bash cmds, but completed, borderline ROUGH/HELLACIOUS
    "post-audit-cleanup.md": 1,  # F2, ~3h, approximate metrics
    "consistency-remediation.md": 1,  # F7 but 15 commits, 2 days -- borderline
    # === HELLACIOUS (F7+, 100+ user msgs, many compactions, or significant abandoned) ===
    "ddau-refactor.md": 2,  # F9, 302 errors, 971 user msgs, 5 days -- the ceiling
    "user-frontend-ddau-roadmap.md": 2,  # F8, meta-plan encompassing all phases
    "uf-phase-4-container-boundaries.md": 2,  # F7, 112 errors, 183 user msgs, 21h
    "uf-phase-7-test-suite.md": 2,  # F7, 49 errors, 241 user msgs, 8h -- user confirmed HELLACIOUS
    "uf-selection-state-migration.md": 2,  # F6, 4 failed BUT 3 compactions, 24h -- user confirmed ROUGH->bumped
    "backlog-cleanup.md": 2,  # F7, 40 failed, 123 user msgs, 23-27h
    # Series A/B have no master plan files (pre-convention). Using first prompt as representative.
    # All pre-convention prompts share the same structural profile (missing headers, pre-flight, etc.)
    "audit-fix-01-chat-trust-boundary.md": 2,  # Series A rep. F8, 82 failed, 58 user msgs, 24h (Mar 4 cluster)
    "audit-fix-01-dead-code-p1.md": 2,  # Series B rep. F6, 31 failed, 32 user msgs, 6h (Mar 5 cluster)
    "coverage-75.md": 2,  # F8, 55 failed, 86 user msgs, 8 compactions, 26h
    "uf-phase-1-foundation.md": 2,  # F5, 36 errors but 59 agents for 3h
    "uf-test-expansion.md": 2,  # F4, ~4 days
    "playwright-hardening.md": 2,  # F4, 3 days
    # === Post-convention ROUGH ===
    "temporal-migration.md": 1,  # F5 C1, 10 prompts, 14 commits, ~5h. Pre-flight CONDITIONAL.
    # === UNKNOWN (no execution data or never executed) ===
    "uf-bff-plan.md": -1,  # Draft, never executed
    "test-quality-fixes.md": -1,  # Unexecuted
    "idiomatic-nextjs-migration.md": -1,  # Standalone analysis
}

GRADE_NAMES = {0: "SMOOTH", 1: "ROUGH", 2: "HELLACIOUS", -1: "UNKNOWN"}

# Map plan filenames to paths
PLAN_DIRS = [
    Path.home() / "plans" / "archive",
    Path.home() / "plans",
]

# Prompt file patterns per plan. Key is plan filename, value is list of
# glob patterns relative to the plan directory (archive/ or plans/).
# Plans not listed here have no known prompt files.
PROMPT_PATTERNS: dict[str, list[str]] = {
    "collocate-tests.md": ["collocate-tests-0*.md"],
    "temporal-migration.md": [
        "temporal-migration-0*.md",
        "temporal-migration-pre-*.md",
    ],
    "delete-deprecated-pages.md": ["delete-deprecated-pages-0*.md"],
    "dev-panel.md": ["dev-panel-0*.md"],
    "fe-audit-fix-26-03-12-09-45-plan.md": ["fe-audit-fix-26-03-12-09-45-P*.md"],
    "bff-audit-fix-26-03-12-09-45-plan.md": ["bff-audit-fix-26-03-12-09-45-P*.md"],
    "bff-audit-fix-v2-26-03-13-plan.md": ["bff-v2-P*.md"],
    "pm-recs-26-03-13-plan.md": ["pm-recs-P*.md"],
    "audit-fix-26-03-10-15-40-plan.md": ["audit-fix-26-03-10-15-40-P*.md"],
    "fe-to-bff-mapper-migration.md": ["fe-to-bff-mapper-migration-0*.md"],
    "interpreter-calibration-infrastructure.md": [
        "interpreter-calibration-infrastructure-0*.md"
    ],
    "ast-tool-enhancements.md": ["ast-enhance-0*.md", "ast-enhance-10-*.md"],
    "ast-tools-plan.md": ["ast-tools-P0*.md"],
    "vitest-parity-tool.md": ["vitest-parity-0*.md"],
    "pw-test-gap-closure.md": [
        "pw-test-gap-closure-0*.md",
        "pw-test-gap-closure-10.md",
    ],
    "consistency-remediation.md": ["consistency-remediation-0*.md"],
    "coverage-75.md": ["coverage-75-0*.md"],
    "playwright-remediation.md": ["playwright-remediation-0*.md"],
    "playwright-hardening.md": ["playwright-hardening-0*.md"],
    "qa-test-migration.md": ["qa-test-migration-0*.md"],
    "bff-lift-and-shift.md": ["bff-lift-and-shift-0*.md"],
}


def find_plan(filename: str) -> Path | None:
    for d in PLAN_DIRS:
        p = d / filename
        if p.exists():
            return p
    return None


def find_prompts(plan_filename: str, plan_path: Path) -> list[Path]:
    """Find prompt files associated with a plan, using PROMPT_PATTERNS."""
    patterns = PROMPT_PATTERNS.get(plan_filename, [])
    if not patterns:
        return []
    plan_dir = plan_path.parent
    prompts: list[Path] = []
    for pattern in patterns:
        prompts.extend(sorted(plan_dir.glob(pattern)))
    # Also check ~/plans/prompts/ for active plans
    prompts_dir = Path.home() / "plans" / "prompts"
    if prompts_dir.exists():
        for pattern in patterns:
            prompts.extend(sorted(prompts_dir.glob(pattern)))
    # Deduplicate and exclude cleanup/plan files
    seen: set[Path] = set()
    result: list[Path] = []
    for p in prompts:
        if p not in seen and "-cleanup" not in p.name and p.name != plan_filename:
            seen.add(p)
            result.append(p)
    return result


COMPLEXITY_METRIC_KINDS = {
    "PROMPT_DEPENDENCY_EDGE_COUNT": "edgeCount",
    "PROMPT_CHAIN_DEPTH": "chainDepth",
    "PROMPT_FAN_OUT": "fanOut",
    "PLAN_PROMPT_COUNT": "promptCount",
    "PLAN_FILE_REFERENCE_DENSITY": "fileRefDensity",
}


def run_plan_audit(
    plan_path: Path, prompt_paths: list[Path] | None = None
) -> dict[str, int]:
    """Run ast-plan-audit on a plan file and return observation kind counts.

    For complexity metric kinds, returns the evidence value (not count).
    """
    cmd = ["npx", "tsx", "scripts/AST/ast-plan-audit.ts", str(plan_path)]
    for p in prompt_paths or []:
        cmd.append(str(p))
    cwd = str(Path.home() / "github" / "user-frontend")
    try:
        result = subprocess.run(
            cmd + ["--count"],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=cwd,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return {}
        counts = json.loads(result.stdout.strip())
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        return {}
    if not any(k in counts for k in COMPLEXITY_METRIC_KINDS):
        return counts
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
            cwd=cwd,
        )
        if result.returncode == 0 and result.stdout.strip():
            full = json.loads(result.stdout.strip())
            for obs in full.get("observations", []):
                kind = obs.get("kind", "")
                if kind in COMPLEXITY_METRIC_KINDS:
                    key = COMPLEXITY_METRIC_KINDS[kind]
                    counts[kind] = obs.get("evidence", {}).get(key, 0)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        pass
    return counts


def main():
    print("=" * 70)
    print("PLAN AUDIT CALIBRATION: PER-CHECK CORRELATION ANALYSIS")
    print("=" * 70)
    print()

    # Phase 1: Collect observations for all plans
    all_obs_kinds: set[str] = set()
    plan_data: list[dict] = []

    plans_with_prompts = 0
    total_prompt_files = 0

    for filename, grade in sorted(FRICTION.items()):
        path = find_plan(filename)
        if not path:
            print(f"  SKIP: {filename} (file not found)")
            continue

        prompts = find_prompts(filename, path)
        obs = run_plan_audit(path, prompts)
        all_obs_kinds.update(obs.keys())
        plan_data.append(
            {
                "filename": filename,
                "grade": grade,
                "grade_name": GRADE_NAMES[grade],
                "observations": obs,
                "prompt_count": len(prompts),
            }
        )
        total_obs = int(
            sum(v for k, v in obs.items() if k not in COMPLEXITY_METRIC_KINDS)
        )
        prompt_tag = f"  [{len(prompts)} prompts]" if prompts else ""
        print(f"  {GRADE_NAMES[grade]:11s}  {total_obs:4d} obs  {filename}{prompt_tag}")
        if prompts:
            plans_with_prompts += 1
            total_prompt_files += len(prompts)

    print()
    print(f"Plans scored: {len(plan_data)}")
    print(
        f"Plans with prompt files: {plans_with_prompts} ({total_prompt_files} total prompts)"
    )
    print(f"Observation kinds found: {len(all_obs_kinds)}")
    print()

    # Filter to plans with known grades (not UNKNOWN)
    graded = [p for p in plan_data if p["grade"] >= 0]
    smooth = [p for p in graded if p["grade"] == 0]
    rough = [p for p in graded if p["grade"] == 1]
    hellacious = [p for p in graded if p["grade"] == 2]

    print(
        f"Grade distribution: SMOOTH={len(smooth)}  ROUGH={len(rough)}  HELLACIOUS={len(hellacious)}"
    )
    print()

    # Phase 2: Per-observation-kind correlation with friction grade
    # For each observation kind, compute:
    #   - Mean count in SMOOTH plans
    #   - Mean count in ROUGH plans
    #   - Mean count in HELLACIOUS plans
    #   - Presence rate in each grade (what % of plans have this kind at all)
    # Then compute point-biserial-ish correlation: does having more of this
    # observation predict higher friction?

    sorted_kinds = sorted(all_obs_kinds)

    print("-" * 70)
    print("PER-OBSERVATION-KIND ANALYSIS")
    print("-" * 70)
    print()
    print(
        f"{'Kind':<40s} {'SMOOTH':>8s} {'ROUGH':>8s} {'HELL':>8s} {'Corr':>8s} {'Signal':>8s}"
    )
    print(f"{'':40s} {'mean':>8s} {'mean':>8s} {'mean':>8s} {'':>8s} {'':>8s}")
    print("-" * 70)

    correlations: list[tuple[str, float]] = []

    for kind in sorted_kinds:
        s_counts = [p["observations"].get(kind, 0) for p in smooth]
        r_counts = [p["observations"].get(kind, 0) for p in rough]
        h_counts = [p["observations"].get(kind, 0) for p in hellacious]

        s_mean = sum(s_counts) / max(len(s_counts), 1)
        r_mean = sum(r_counts) / max(len(r_counts), 1)
        h_mean = sum(h_counts) / max(len(h_counts), 1)

        # Simple correlation: weighted mean grade for plans that have this kind
        # vs plans that don't. Positive = having it predicts higher friction.
        has_kind = [(p["grade"], p["observations"].get(kind, 0)) for p in graded]
        present = [g for g, c in has_kind if c > 0]
        absent = [g for g, c in has_kind if c == 0]

        if present and absent:
            mean_present = sum(present) / len(present)
            mean_absent = sum(absent) / len(absent)
            corr = mean_present - mean_absent
        else:
            corr = 0.0

        # Signal strength: does the mean count monotonically increase with grade?
        monotonic = s_mean <= r_mean <= h_mean
        anti = s_mean >= r_mean >= h_mean and (s_mean > h_mean)
        if monotonic and h_mean > s_mean:
            signal = "PREDICT"
        elif anti:
            signal = "ANTI"
        else:
            signal = "NOISE"

        correlations.append((kind, corr))

        print(
            f"{kind:<40s} {s_mean:8.2f} {r_mean:8.2f} {h_mean:8.2f} {corr:+8.2f} {signal:>8s}"
        )

    print()
    print("-" * 70)
    print("CURRENT INTERPRETER WEIGHTS vs FRICTION CORRELATION")
    print("-" * 70)
    print()

    # Load current weights from config for comparison
    current_severity = {
        "PROMPT_DEPENDENCY_CYCLE": ("blocker", 30),
        "PROMPT_FILE_MISSING": ("blocker", 20),
        "VERIFICATION_BLOCK_MISSING": ("blocker", 20),
        "PLAN_HEADER_MISSING": ("warning", 8),
        "PLAN_HEADER_INVALID": ("warning", 1),
        "PRE_FLIGHT_MARK_MISSING": ("warning", 10),
        "CLEANUP_FILE_MISSING": ("warning", 10),
        "PROMPT_VERIFICATION_MISSING": ("warning", 10),
        "RECONCILIATION_TEMPLATE_MISSING": ("warning", 5),
        "PROMPT_MODE_UNSET": ("warning", 5),
        "STANDING_ELEMENT_MISSING": ("warning", 3),
        "CLIENT_SIDE_AGGREGATION": ("warning", 5),
        "PRE_FLIGHT_CERTIFIED": ("info", 0),
        "NAMING_CONVENTION_INSTRUCTION": ("info", 0),
        "DEFERRED_CLEANUP_REFERENCE": ("info", 0),
        "FILE_PATH_REFERENCE": ("info", 0),
        "SKILL_REFERENCE": ("info", 0),
        "PROMPT_DEPENDENCY_EDGE_COUNT": ("info", 0),
        "PROMPT_CHAIN_DEPTH": ("info", 0),
        "PROMPT_FAN_OUT": ("info", 0),
        "PLAN_PROMPT_COUNT": ("info", 0),
        "PLAN_FILE_REFERENCE_DENSITY": ("info", 0),
    }

    corr_map = dict(correlations)

    print(f"{'Kind':<40s} {'Severity':>10s} {'Weight':>8s} {'Corr':>8s} {'Assessment'}")
    print("-" * 90)

    for kind, (severity, weight) in sorted(current_severity.items()):
        corr = corr_map.get(kind, 0.0)
        if weight > 0 and corr <= 0:
            assessment = "OVER-PENALIZING (high weight, no friction correlation)"
        elif weight > 0 and corr > 0.3:
            assessment = "WELL-CALIBRATED (weight matches friction signal)"
        elif weight > 0 and 0 < corr <= 0.3:
            assessment = "WEAK SIGNAL (weight may be too high)"
        elif weight == 0 and corr > 0.3:
            assessment = "UNDER-PENALIZING (zero weight but predicts friction)"
        else:
            assessment = "OK (info-level, low/no correlation)"
        print(f"{kind:<40s} {severity:>10s} {weight:>8d} {corr:+8.2f} {assessment}")

    print()
    print("=" * 70)
    print("INTERPRETATION GUIDE")
    print("=" * 70)
    print("""
Corr > 0:  Plans with this observation tend to have HIGHER friction.
           The check is detecting something that predicts execution trouble.
Corr < 0:  Plans with this observation tend to have LOWER friction.
           The check is penalizing something associated with GOOD plans.
Corr ~ 0:  No relationship. The check is noise for calibration purposes.

PREDICT:   Mean count increases monotonically from SMOOTH -> ROUGH -> HELLACIOUS.
ANTI:      Mean count decreases -- the observation is more common in good plans.
NOISE:     No monotonic pattern.

OVER-PENALIZING checks should have their weight reduced or severity downgraded.
UNDER-PENALIZING checks should have their weight increased.
ANTI-correlated checks should be investigated -- they may need to be removed
from scoring entirely or converted to positive signals.
""")


if __name__ == "__main__":
    main()
