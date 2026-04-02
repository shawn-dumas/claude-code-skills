/**
 * ast-peer-deps: Analyze npm peerDependency compatibility.
 *
 * Reads the project's package.json, resolves installed versions from
 * node_modules, evaluates peerDependency semver constraints, and emits
 * structured observations for satisfied, violated, and optional-missing peers.
 *
 * This tool does NOT use ts-morph (no AST parsing). It reads JSON metadata
 * from the filesystem and applies semver range evaluation.
 */

import path from 'path';
import fs from 'fs';
import { PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import type { PeerDepAnalysis, PeerDepObservation, ObservationResult } from './types';

// ---------------------------------------------------------------------------
// Semver range evaluation (no external dependency)
// ---------------------------------------------------------------------------

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseVersion(version: string): ParsedVersion | null {
  // Strip leading v or =
  const cleaned = version.replace(/^[v=]+/, '').trim();

  // Full: 1.2.3 or 1.2.3-alpha.1
  const fullMatch = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?/.exec(cleaned);
  if (fullMatch) {
    return {
      major: Number(fullMatch[1]),
      minor: Number(fullMatch[2]),
      patch: Number(fullMatch[3]),
      prerelease: fullMatch[4] ? fullMatch[4].split('.') : [],
    };
  }

  // Partial: 1.2
  const partialMatch = /^(\d+)\.(\d+)$/.exec(cleaned);
  if (partialMatch) {
    return {
      major: Number(partialMatch[1]),
      minor: Number(partialMatch[2]),
      patch: 0,
      prerelease: [],
    };
  }

  // Major only: 18
  const majorMatch = /^(\d+)$/.exec(cleaned);
  if (majorMatch) {
    return {
      major: Number(majorMatch[1]),
      minor: 0,
      patch: 0,
      prerelease: [],
    };
  }

  return null;
}

/**
 * Compare two parsed versions. Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;

  // Prerelease versions have lower precedence than release
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;

  // Compare prerelease identifiers
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i++) {
    if (i >= a.prerelease.length) return -1;
    if (i >= b.prerelease.length) return 1;
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (aNum) {
      return -1;
    } else if (bNum) {
      return 1;
    } else {
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    }
  }

  return 0;
}

/**
 * Check if a version satisfies a single comparator (e.g., ">=1.2.3", "<2.0.0").
 */
function satisfiesComparator(version: ParsedVersion, comparator: string): boolean {
  const trimmed = comparator.trim();
  if (trimmed === '' || trimmed === '*') return true;

  // Handle caret ranges: ^1.2.3
  if (trimmed.startsWith('^')) {
    const target = parseVersion(trimmed.slice(1));
    if (!target) return false;
    return satisfiesCaretRange(version, target);
  }

  // Handle tilde ranges: ~1.2.3
  if (trimmed.startsWith('~')) {
    const target = parseVersion(trimmed.slice(1));
    if (!target) return false;
    return satisfiesTildeRange(version, target);
  }

  // Handle x-ranges: 1.x, 1.2.x, 1.*, 1.2.*
  if (
    /[xX*]/.test(trimmed) &&
    !trimmed.startsWith('>=') &&
    !trimmed.startsWith('<=') &&
    !trimmed.startsWith('>') &&
    !trimmed.startsWith('<') &&
    !trimmed.startsWith('=')
  ) {
    return satisfiesXRange(version, trimmed);
  }

  // Handle hyphen range: 1.0.0 - 2.0.0 (handled at the range level, not here)

  // Handle comparison operators with partial version coercion.
  // npm semver treats partial versions differently per operator:
  //   >=19   -> >=19.0.0
  //   <=19   -> <20.0.0-0  (includes all of 19.x.x)
  //   >19    -> >=20.0.0
  //   <19    -> <19.0.0
  const opMatch = /^(>=|<=|>|<|=)(.+)$/.exec(trimmed);
  if (opMatch) {
    const op = opMatch[1];
    // Replace x/X/* with 0 in the target version for operator comparisons
    const rawTarget = opMatch[2].trim().replace(/[xX*]/g, '0');
    const isPartialMajor = /^\d+$/.test(rawTarget);
    const isPartialMinor = /^\d+\.\d+$/.test(rawTarget);
    const target = parseVersion(rawTarget);
    if (!target) return false;

    if (isPartialMajor) {
      switch (op) {
        case '>=':
          return version.major >= target.major;
        case '<=':
          return version.major <= target.major;
        case '>':
          return version.major > target.major;
        case '<':
          return version.major < target.major;
        case '=':
          return version.major === target.major;
      }
    }

    if (isPartialMinor) {
      switch (op) {
        case '>=':
          return version.major > target.major || (version.major === target.major && version.minor >= target.minor);
        case '<=':
          return version.major < target.major || (version.major === target.major && version.minor <= target.minor);
        case '>':
          return version.major > target.major || (version.major === target.major && version.minor > target.minor);
        case '<':
          return version.major < target.major || (version.major === target.major && version.minor < target.minor);
        case '=':
          return version.major === target.major && version.minor === target.minor;
      }
    }

    const cmp = compareVersions(version, target);
    switch (op) {
      case '>=':
        return cmp >= 0;
      case '<=':
        return cmp <= 0;
      case '>':
        return cmp > 0;
      case '<':
        return cmp < 0;
      case '=':
        return cmp === 0;
    }
  }

  // Bare version: treat as exact match
  const target = parseVersion(trimmed);
  if (!target) return false;
  return compareVersions(version, target) === 0;
}

function satisfiesCaretRange(version: ParsedVersion, target: ParsedVersion): boolean {
  // ^0.0.3 -> >=0.0.3 <0.0.4
  // ^0.2.3 -> >=0.2.3 <0.3.0
  // ^1.2.3 -> >=1.2.3 <2.0.0
  if (compareVersions(version, target) < 0) return false;

  if (target.major > 0) {
    return version.major === target.major;
  }
  if (target.minor > 0) {
    return version.major === 0 && version.minor === target.minor;
  }
  return version.major === 0 && version.minor === 0 && version.patch === target.patch;
}

function satisfiesTildeRange(version: ParsedVersion, target: ParsedVersion): boolean {
  // ~1.2.3 -> >=1.2.3 <1.3.0
  if (compareVersions(version, target) < 0) return false;
  return version.major === target.major && version.minor === target.minor;
}

function satisfiesXRange(version: ParsedVersion, range: string): boolean {
  const parts = range.split('.');
  const majorStr = parts[0];
  const minorStr = parts[1];

  // *, x, X -> any version
  if (/^[xX*]$/.test(majorStr)) return true;

  const major = Number(majorStr);
  if (version.major !== major) return false;

  // 1.x, 1.* -> major must match
  if (!minorStr || /^[xX*]$/.test(minorStr)) return true;

  const minor = Number(minorStr);
  if (version.minor !== minor) return false;

  // 1.2.x, 1.2.* -> major and minor must match
  return true;
}

/**
 * Check if a version satisfies a range string.
 *
 * Supports: ||, spaces (AND), ^, ~, >=, <=, >, <, =, x-ranges, hyphen ranges.
 */
export function satisfies(versionStr: string, rangeStr: string): boolean {
  const version = parseVersion(versionStr);
  if (!version) return false;

  // Split by || first (OR groups)
  const orGroups = rangeStr.split('||').map(s => s.trim());

  for (const group of orGroups) {
    if (satisfiesAndGroup(version, group)) return true;
  }

  return false;
}

function satisfiesAndGroup(version: ParsedVersion, group: string): boolean {
  // Handle hyphen ranges: 1.0.0 - 2.0.0 -> >=1.0.0 <=2.0.0
  const hyphenMatch = /^(\S+)\s+-\s+(\S+)$/.exec(group);
  if (hyphenMatch) {
    return satisfiesComparator(version, `>=${hyphenMatch[1]}`) && satisfiesComparator(version, `<=${hyphenMatch[2]}`);
  }

  // Normalize spacing: collapse ">= 16" into ">=16", "<= 19" into "<=19", etc.
  // This handles constraints like ">= 16 <= 19" where spaces separate operators from versions.
  const normalized = group.replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1');

  // Split by space (AND conditions)
  const comparators = normalized.split(/\s+/).filter(Boolean);
  if (comparators.length === 0) return true;

  return comparators.every(c => satisfiesComparator(version, c));
}

// ---------------------------------------------------------------------------
// Package.json reading
// ---------------------------------------------------------------------------

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

function readPackageJson(filePath: string): PackageJson | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

/**
 * Resolve the installed version of a package from node_modules.
 * Handles scoped packages (@scope/name).
 */
function getInstalledVersion(projectRoot: string, packageName: string): string | null {
  const pkgJsonPath = path.join(projectRoot, 'node_modules', packageName, 'package.json');
  const pkg = readPackageJson(pkgJsonPath);
  return pkg?.version ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzePeerDeps(projectRoot?: string): PeerDepAnalysis {
  const root = projectRoot
    ? path.isAbsolute(projectRoot)
      ? projectRoot
      : path.resolve(PROJECT_ROOT, projectRoot)
    : PROJECT_ROOT;

  const pkgJsonPath = path.join(root, 'package.json');
  const pkg = readPackageJson(pkgJsonPath);

  if (!pkg) {
    return {
      projectRoot: path.relative(PROJECT_ROOT, root) || '.',
      observations: [],
      summary: { satisfied: 0, violated: 0, optionalMissing: 0, totalPeers: 0 },
    };
  }

  const directDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  const observations: PeerDepObservation[] = [];

  const depNames = Object.keys(directDeps).sort();

  for (const depName of depNames) {
    const depPkgJsonPath = path.join(root, 'node_modules', depName, 'package.json');
    const depPkg = readPackageJson(depPkgJsonPath);
    if (!depPkg) continue;

    const peerDeps = depPkg.peerDependencies;
    if (!peerDeps) continue;

    const peerMeta = depPkg.peerDependenciesMeta ?? {};
    const depVersion = depPkg.version ?? directDeps[depName];

    for (const [peerName, constraint] of Object.entries(peerDeps)) {
      // Skip self-references
      if (peerName === depName) continue;

      const isOptional = peerMeta[peerName]?.optional === true;
      const installedPeerVersion = getInstalledVersion(root, peerName);
      const file = `node_modules/${depName}/package.json`;

      if (!installedPeerVersion) {
        if (isOptional) {
          observations.push({
            kind: 'PEER_DEP_OPTIONAL_MISSING',
            file,
            line: 0,
            evidence: {
              package: depName,
              packageVersion: depVersion,
              peer: peerName,
              constraint,
            },
          });
        } else {
          observations.push({
            kind: 'PEER_DEP_VIOLATED',
            file,
            line: 0,
            evidence: {
              package: depName,
              packageVersion: depVersion,
              peer: peerName,
              constraint,
              reason: 'not-installed',
            },
          });
        }
        continue;
      }

      const isSatisfied = satisfies(installedPeerVersion, constraint);

      if (isSatisfied) {
        observations.push({
          kind: 'PEER_DEP_SATISFIED',
          file,
          line: 0,
          evidence: {
            package: depName,
            packageVersion: depVersion,
            peer: peerName,
            constraint,
            installedPeerVersion,
          },
        });
      } else {
        observations.push({
          kind: 'PEER_DEP_VIOLATED',
          file,
          line: 0,
          evidence: {
            package: depName,
            packageVersion: depVersion,
            peer: peerName,
            constraint,
            installedPeerVersion,
            reason: 'version-mismatch',
          },
        });
      }
    }
  }

  const satisfied = observations.filter(o => o.kind === 'PEER_DEP_SATISFIED').length;
  const violated = observations.filter(o => o.kind === 'PEER_DEP_VIOLATED').length;
  const optionalMissing = observations.filter(o => o.kind === 'PEER_DEP_OPTIONAL_MISSING').length;

  return {
    projectRoot: path.relative(PROJECT_ROOT, root) || '.',
    observations,
    summary: {
      satisfied,
      violated,
      optionalMissing,
      totalPeers: observations.length,
    },
  };
}

export function extractPeerDepObservations(analysis: PeerDepAnalysis): ObservationResult<PeerDepObservation> {
  return {
    filePath: analysis.projectRoot,
    observations: analysis.observations,
  };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatPrettyTable(analysis: PeerDepAnalysis): string {
  const lines: string[] = [];
  lines.push('PEER DEPENDENCY ANALYSIS');
  lines.push('========================');

  if (analysis.observations.length === 0) {
    lines.push('No peer dependencies found.');
    return lines.join('\n');
  }

  // Column headers
  const header = [
    'Package'.padEnd(40),
    'Peer'.padEnd(25),
    'Constraint'.padEnd(18),
    'Installed'.padEnd(12),
    'Status',
  ].join('  ');
  lines.push(header);
  lines.push('-'.repeat(header.length));

  for (const obs of analysis.observations) {
    const e = obs.evidence;
    const pkg = e.package.length > 40 ? e.package.slice(0, 37) + '...' : e.package.padEnd(40);
    const peer = e.peer.length > 25 ? e.peer.slice(0, 22) + '...' : e.peer.padEnd(25);
    const constraint = e.constraint.length > 18 ? e.constraint.slice(0, 15) + '...' : e.constraint.padEnd(18);

    let installed: string;
    let status: string;

    if (obs.kind === 'PEER_DEP_SATISFIED') {
      installed = (e.installedPeerVersion ?? '').padEnd(12);
      status = 'OK';
    } else if (obs.kind === 'PEER_DEP_VIOLATED') {
      installed = (e.installedPeerVersion ?? 'MISSING').padEnd(12);
      status = e.reason === 'not-installed' ? 'VIOLATED (not installed)' : 'VIOLATED';
    } else {
      installed = 'MISSING'.padEnd(12);
      status = 'OPTIONAL (not installed)';
    }

    lines.push(`${pkg}  ${peer}  ${constraint}  ${installed}  ${status}`);
  }

  lines.push('');
  lines.push(
    `Summary: ${analysis.summary.satisfied} satisfied, ` +
      `${analysis.summary.violated} violated, ` +
      `${analysis.summary.optionalMissing} optional missing, ` +
      `${analysis.summary.totalPeers} total`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-peer-deps.ts [<project-root>] [--pretty] [--kind <kind>] [--count]\n' +
        '\n' +
        'Analyze npm peerDependency compatibility for all direct dependencies.\n' +
        '\n' +
        '  <project-root>  Path to project root (defaults to cwd)\n' +
        '  --pretty        Human-readable table output\n' +
        '  --kind <kind>   Filter observations to a specific kind\n' +
        '  --count         Output observation kind counts instead of full data\n',
    );
    process.exit(0);
  }

  const projectRoot = args.paths.length > 0 ? args.paths[0] : undefined;

  if (projectRoot) {
    const absolute = path.isAbsolute(projectRoot) ? projectRoot : path.resolve(PROJECT_ROOT, projectRoot);
    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${projectRoot}`);
    }
  }

  const analysis = analyzePeerDeps(projectRoot);

  if (args.pretty && !args.options.kind && !args.flags.has('count')) {
    process.stdout.write(formatPrettyTable(analysis) + '\n');
    return;
  }

  outputFiltered(analysis, args.pretty, {
    kind: args.options.kind,
    count: args.flags.has('count'),
  });
}

/* v8 ignore start */
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-peer-deps.ts') || process.argv[1].endsWith('ast-peer-deps'));

if (isDirectRun) {
  main();
}
/* v8 ignore stop */
