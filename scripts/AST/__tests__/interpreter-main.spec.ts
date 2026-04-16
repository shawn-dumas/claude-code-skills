/**
 * Tests for interpreter main() CLI entry points.
 *
 * Each interpreter's main() is tested for:
 * - --help flag (exits 0, prints usage)
 * - No args (exits 1 via fatal)
 * - Valid fixture path (produces output)
 * - --pretty flag (produces formatted output) where applicable
 *
 * The classification logic is already tested in each interpreter's own spec.
 * These tests focus on the CLI wrapper: arg parsing, file I/O, output format.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// ---------------------------------------------------------------------------
// Process mock helpers (same pattern as cli-runner.spec.ts)
// ---------------------------------------------------------------------------

let stdoutChunks: string[];
let stderrChunks: string[];
let originalArgv: string[];

beforeEach(() => {
  stdoutChunks = [];
  stderrChunks = [];
  originalArgv = process.argv;

  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdoutChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderrChunks.push(String(chunk));
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

function setArgv(tool: string, ...args: string[]): void {
  process.argv = ['node', tool, ...args];
}

function stdout(): string {
  return stdoutChunks.join('');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FX = {
  effects: path.join(FIXTURES_DIR, 'component-with-effects.tsx'),
  hooks: path.join(FIXTURES_DIR, 'hook-classification.tsx'),
  template: path.join(FIXTURES_DIR, 'component-with-jsx-complexity.tsx'),
  ownership: path.join(FIXTURES_DIR, 'component-with-effects.tsx'),
  branchClassification: path.join(FIXTURES_DIR, 'branch-classification-samples.tsx'),
  nullDisplay: path.join(FIXTURES_DIR, 'null-display-samples.tsx'),
  deadExport: path.join(FIXTURES_DIR, 'dead-export.ts'),
  planAudit: path.join(FIXTURES_DIR, 'plan-audit'),
  skillAnalysis: path.join(FIXTURES_DIR, 'skill-analysis'),
  testQuality: path.join(FIXTURES_DIR, 'test-quality-with-helper.spec.ts'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('interpreter main() functions', () => {
  // -----------------------------------------------------------------------
  // ast-interpret-effects
  // -----------------------------------------------------------------------
  describe('ast-interpret-effects', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-effects');
      setArgv('ast-interpret-effects.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-effects');
      setArgv('ast-interpret-effects.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('valid file produces JSON output', async () => {
      const { main } = await import('../ast-interpret-effects');
      setArgv('ast-interpret-effects.ts', FX.effects);
      main();
      expect(JSON.parse(stdout())).toHaveProperty('assessments');
    });

    it('--pretty produces formatted table', async () => {
      const { main } = await import('../ast-interpret-effects');
      setArgv('ast-interpret-effects.ts', FX.effects, '--pretty');
      main();
      expect(stdout()).toContain('Effect Assessments:');
    });

    it('directory with multiple files uses cachedDirectory path', async () => {
      const { main } = await import('../ast-interpret-effects');
      // Use a small temp dir with 2 tsx files to trigger the directory/multi-file
      // branch without scanning the entire fixtures directory.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-effects-multi-'));
      fs.writeFileSync(
        path.join(tmpDir, 'a.tsx'),
        'import { useEffect } from "react";\nfunction A() { useEffect(() => {}, []); return <div/>; }\nexport default A;\n',
      );
      fs.writeFileSync(
        path.join(tmpDir, 'b.tsx'),
        'import { useEffect } from "react";\nfunction B() { useEffect(() => { console.log("x"); }, []); return <span/>; }\nexport default B;\n',
      );
      try {
        setArgv('ast-interpret-effects.ts', tmpDir, '--no-cache');
        main();
        expect(JSON.parse(stdout())).toHaveProperty('assessments');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('empty directory exits 1 via fatal', async () => {
      const { main } = await import('../ast-interpret-effects');
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-effects-test-'));
      try {
        setArgv('ast-interpret-effects.ts', emptyDir);
        expect(() => main()).toThrow('process.exit(1)');
      } finally {
        fs.rmdirSync(emptyDir);
      }
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-hooks
  // -----------------------------------------------------------------------
  describe('ast-interpret-hooks', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-hooks');
      setArgv('ast-interpret-hooks.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-hooks');
      setArgv('ast-interpret-hooks.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('valid file produces JSON output', async () => {
      const { main } = await import('../ast-interpret-hooks');
      setArgv('ast-interpret-hooks.ts', FX.hooks);
      main();
      expect(JSON.parse(stdout())).toHaveProperty('assessments');
    });

    it('--pretty produces formatted table', async () => {
      const { main } = await import('../ast-interpret-hooks');
      setArgv('ast-interpret-hooks.ts', FX.hooks, '--pretty');
      main();
      expect(stdout()).toContain('Hook Assessments:');
    });

    it('directory with multiple files uses cachedDirectory path', async () => {
      const { main } = await import('../ast-interpret-hooks');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-hooks-multi-'));
      fs.writeFileSync(
        path.join(tmpDir, 'a.tsx'),
        'import { useState } from "react";\nfunction A() { const [x] = useState(0); return <div>{x}</div>; }\nexport default A;\n',
      );
      fs.writeFileSync(
        path.join(tmpDir, 'b.tsx'),
        'import { useMemo } from "react";\nfunction B() { const v = useMemo(() => 1, []); return <span>{v}</span>; }\nexport default B;\n',
      );
      try {
        setArgv('ast-interpret-hooks.ts', tmpDir, '--no-cache');
        main();
        expect(JSON.parse(stdout())).toHaveProperty('assessments');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('empty directory exits 1 via fatal', async () => {
      const { main } = await import('../ast-interpret-hooks');
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-hooks-test-'));
      try {
        setArgv('ast-interpret-hooks.ts', emptyDir);
        expect(() => main()).toThrow('process.exit(1)');
      } finally {
        fs.rmdirSync(emptyDir);
      }
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-template
  // -----------------------------------------------------------------------
  describe('ast-interpret-template', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-template');
      setArgv('ast-interpret-template.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-template');
      setArgv('ast-interpret-template.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('valid file produces JSON output', async () => {
      const { main } = await import('../ast-interpret-template');
      setArgv('ast-interpret-template.ts', FX.template);
      main();
      expect(JSON.parse(stdout())).toHaveProperty('assessments');
    });

    it('--pretty produces formatted table', async () => {
      const { main } = await import('../ast-interpret-template');
      setArgv('ast-interpret-template.ts', FX.template, '--pretty');
      main();
      expect(stdout()).toContain('Template Assessments:');
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-ownership
  // -----------------------------------------------------------------------
  describe('ast-interpret-ownership', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-ownership');
      setArgv('ast-interpret-ownership.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-ownership');
      setArgv('ast-interpret-ownership.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('valid file produces JSON output', async () => {
      const { main } = await import('../ast-interpret-ownership');
      setArgv('ast-interpret-ownership.ts', FX.ownership);
      main();
      expect(JSON.parse(stdout())).toHaveProperty('assessments');
    });

    it('--pretty produces formatted table', async () => {
      const { main } = await import('../ast-interpret-ownership');
      setArgv('ast-interpret-ownership.ts', FX.ownership, '--pretty');
      main();
      expect(stdout()).toContain('Ownership Assessments:');
    });

    it('directory with multiple files uses cachedDirectory path', async () => {
      const { main } = await import('../ast-interpret-ownership');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-ownership-multi-'));
      fs.writeFileSync(
        path.join(tmpDir, 'a.tsx'),
        'import { useState } from "react";\nfunction A() { const [x] = useState(0); return <div>{x}</div>; }\nexport default A;\n',
      );
      fs.writeFileSync(
        path.join(tmpDir, 'b.tsx'),
        'function B({ label }: { label: string }) { return <span>{label}</span>; }\nexport default B;\n',
      );
      try {
        setArgv('ast-interpret-ownership.ts', tmpDir, '--no-cache');
        main();
        expect(JSON.parse(stdout())).toHaveProperty('assessments');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('empty directory exits 1 via fatal', async () => {
      const { main } = await import('../ast-interpret-ownership');
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-ownership-test-'));
      try {
        setArgv('ast-interpret-ownership.ts', emptyDir);
        expect(() => main()).toThrow('process.exit(1)');
      } finally {
        fs.rmdirSync(emptyDir);
      }
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-branch-classification
  // -----------------------------------------------------------------------
  describe('ast-interpret-branch-classification', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-branch-classification');
      setArgv('ast-interpret-branch-classification.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-branch-classification');
      setArgv('ast-interpret-branch-classification.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('valid file produces JSON output', async () => {
      const { main } = await import('../ast-interpret-branch-classification');
      setArgv('ast-interpret-branch-classification.ts', FX.branchClassification);
      main();
      expect(JSON.parse(stdout())).toHaveProperty('assessments');
    });

    it('--pretty produces formatted table', async () => {
      const { main } = await import('../ast-interpret-branch-classification');
      setArgv('ast-interpret-branch-classification.ts', FX.branchClassification, '--pretty');
      main();
      expect(stdout()).toContain('Branch Classification:');
    });

    it('directory with multiple files uses cachedDirectory path', async () => {
      const { main } = await import('../ast-interpret-branch-classification');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-branch-multi-'));
      fs.writeFileSync(
        path.join(tmpDir, 'a.ts'),
        'function foo(x: string | number) { if (typeof x === "string") return x.length; return x; }\nexport { foo };\n',
      );
      fs.writeFileSync(
        path.join(tmpDir, 'b.ts'),
        'function bar(v: unknown) { if (v == null) return 0; return 1; }\nexport { bar };\n',
      );
      try {
        setArgv('ast-interpret-branch-classification.ts', tmpDir, '--no-cache');
        main();
        expect(JSON.parse(stdout())).toHaveProperty('assessments');
      } finally {
        fs.rmSync(tmpDir, { recursive: true });
      }
    });

    it('empty directory exits 1 via fatal', async () => {
      const { main } = await import('../ast-interpret-branch-classification');
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-branch-test-'));
      try {
        setArgv('ast-interpret-branch-classification.ts', emptyDir);
        expect(() => main()).toThrow('process.exit(1)');
      } finally {
        fs.rmdirSync(emptyDir);
      }
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-display-format
  // -----------------------------------------------------------------------
  describe('ast-interpret-display-format', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-display-format');
      setArgv('ast-interpret-display-format.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-display-format');
      setArgv('ast-interpret-display-format.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('valid file produces JSON output', async () => {
      const { main } = await import('../ast-interpret-display-format');
      setArgv('ast-interpret-display-format.ts', FX.nullDisplay);
      main();
      expect(JSON.parse(stdout())).toHaveProperty('assessments');
    });

    it('--pretty produces formatted table', async () => {
      const { main } = await import('../ast-interpret-display-format');
      setArgv('ast-interpret-display-format.ts', FX.nullDisplay, '--pretty');
      main();
      expect(stdout()).toContain('Display Format Assessments:');
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-dead-code
  // -----------------------------------------------------------------------
  describe('ast-interpret-dead-code', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-dead-code');
      setArgv('ast-interpret-dead-code.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-dead-code');
      setArgv('ast-interpret-dead-code.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('valid file produces JSON output', async () => {
      const { main } = await import('../ast-interpret-dead-code');
      setArgv('ast-interpret-dead-code.ts', FX.deadExport);
      main();
      expect(JSON.parse(stdout())).toHaveProperty('assessments');
    });

    it('--pretty produces formatted table', async () => {
      const { main } = await import('../ast-interpret-dead-code');
      setArgv('ast-interpret-dead-code.ts', FX.deadExport, '--pretty');
      main();
      expect(stdout()).toContain('Dead Code Assessments:');
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-plan-audit
  // -----------------------------------------------------------------------
  describe('ast-interpret-plan-audit', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-plan-audit');
      setArgv('ast-interpret-plan-audit.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-plan-audit');
      setArgv('ast-interpret-plan-audit.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-skill-quality
  // -----------------------------------------------------------------------
  describe('ast-interpret-skill-quality', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-skill-quality');
      setArgv('ast-interpret-skill-quality.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-skill-quality');
      setArgv('ast-interpret-skill-quality.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('non-existent path exits 1', async () => {
      const { main } = await import('../ast-interpret-skill-quality');
      setArgv('ast-interpret-skill-quality.ts', '/tmp/nonexistent-skill-path-12345');
      expect(() => main()).toThrow('process.exit(1)');
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-test-quality
  // -----------------------------------------------------------------------
  describe('ast-interpret-test-quality', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-test-quality');
      setArgv('ast-interpret-test-quality.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-test-quality');
      setArgv('ast-interpret-test-quality.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('non-existent path exits 1', async () => {
      const { main } = await import('../ast-interpret-test-quality');
      setArgv('ast-interpret-test-quality.ts', '/tmp/nonexistent-test-path-12345');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('valid test file produces JSON output', async () => {
      const { main } = await import('../ast-interpret-test-quality');
      setArgv('ast-interpret-test-quality.ts', FX.testQuality);
      main();
      expect(JSON.parse(stdout())).toHaveProperty('assessments');
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-pw-test-parity
  // -----------------------------------------------------------------------
  describe('ast-interpret-pw-test-parity', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-pw-test-parity');
      setArgv('ast-interpret-pw-test-parity.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no --source-dir exits 1', async () => {
      const { main } = await import('../ast-interpret-pw-test-parity');
      setArgv('ast-interpret-pw-test-parity.ts', '--target-dir', '/tmp');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('no --target-dir exits 1', async () => {
      const { main } = await import('../ast-interpret-pw-test-parity');
      setArgv('ast-interpret-pw-test-parity.ts', '--source-dir', '/tmp');
      expect(() => main()).toThrow('process.exit(1)');
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-vitest-parity
  // -----------------------------------------------------------------------
  describe('ast-interpret-vitest-parity', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-vitest-parity');
      setArgv('ast-interpret-vitest-parity.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no --source-dir exits 1', async () => {
      const { main } = await import('../ast-interpret-vitest-parity');
      setArgv('ast-interpret-vitest-parity.ts', '--target-dir', '/tmp');
      expect(() => main()).toThrow('process.exit(1)');
    });

    it('no --target-dir exits 1', async () => {
      const { main } = await import('../ast-interpret-vitest-parity');
      setArgv('ast-interpret-vitest-parity.ts', '--source-dir', '/tmp');
      expect(() => main()).toThrow('process.exit(1)');
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-refactor-intent
  // -----------------------------------------------------------------------
  describe('ast-interpret-refactor-intent', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-refactor-intent');
      setArgv('ast-interpret-refactor-intent.ts', '--help');
      expect(() => main()).toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args exits 1', async () => {
      const { main } = await import('../ast-interpret-refactor-intent');
      setArgv('ast-interpret-refactor-intent.ts');
      expect(() => main()).toThrow('process.exit(1)');
    });
  });

  // -----------------------------------------------------------------------
  // ast-interpret-test-coverage
  // -----------------------------------------------------------------------
  describe('ast-interpret-test-coverage', () => {
    it('--help exits 0', async () => {
      const { main } = await import('../ast-interpret-test-coverage');
      setArgv('ast-interpret-test-coverage.ts', '--help');
      await expect(main()).rejects.toThrow('process.exit(0)');
      expect(stdout()).toContain('Usage:');
    });

    it('no args with TTY stdin exits 1', async () => {
      const { main } = await import('../ast-interpret-test-coverage');
      setArgv('ast-interpret-test-coverage.ts');
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      try {
        await expect(main()).rejects.toThrow('process.exit(1)');
      } finally {
        Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
      }
    });
  });
});
