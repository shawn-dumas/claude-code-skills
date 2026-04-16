#!/usr/bin/env -S npx tsx
/**
 * Run stryker mutation testing against a single target file.
 *
 * Usage:
 *   npx tsx scripts/run-mutation.ts <target-file>
 *   npx tsx scripts/run-mutation.ts <target-file> --concurrency 8
 *
 * Invokes stryker with `--mutate <target>` to override the config's mutate
 * field, so you do not need to edit stryker.config.json for per-file runs.
 * Writes reports/mutation/mutation.json at repo root (stryker default).
 *
 * Additional flags after the target path are forwarded to stryker.
 */

import { spawn } from 'child_process';

function main(): void {
  const [target, ...extra] = process.argv.slice(2);

  if (!target || target.startsWith('--')) {
    console.error('usage: run-mutation.ts <target-file> [stryker flags...]');
    process.exit(1);
  }

  const args = ['stryker', 'run', '--mutate', target, ...extra];
  const child = spawn('npx', args, { stdio: 'inherit' });

  child.on('exit', code => {
    process.exit(code ?? 1);
  });
}

main();
