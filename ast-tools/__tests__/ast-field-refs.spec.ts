import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { analyzeFile, main } from '../ast-field-refs';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURE = path.join(FIXTURES_DIR, 'field-refs-samples.ts');

// ---------------------------------------------------------------------------
// analyzeFile
// ---------------------------------------------------------------------------

describe('analyzeFile', () => {
  it('detects property_access references', () => {
    const refs = analyzeFile(FIXTURE, 'active_time_ms');
    const access = refs.filter(r => r.kind === 'property_access');
    expect(access.length).toBeGreaterThanOrEqual(1);
    expect(access[0].context).toContain('active_time_ms');
  });

  it('detects destructuring references', () => {
    const refs = analyzeFile(FIXTURE, 'active_time_ms');
    const destr = refs.filter(r => r.kind === 'destructuring');
    expect(destr.length).toBeGreaterThanOrEqual(1);
  });

  it('detects element_access references', () => {
    const refs = analyzeFile(FIXTURE, 'active_time_ms');
    const elem = refs.filter(r => r.kind === 'element_access');
    expect(elem.length).toBeGreaterThanOrEqual(1);
  });

  it('detects object_literal references (named and shorthand)', () => {
    const refs = analyzeFile(FIXTURE, 'active_time_ms');
    const obj = refs.filter(r => r.kind === 'object_literal');
    expect(obj.length).toBeGreaterThanOrEqual(2); // { active_time_ms: 100 } + { active_time_ms }
  });

  it('detects type_property references', () => {
    const refs = analyzeFile(FIXTURE, 'active_time_ms');
    const type = refs.filter(r => r.kind === 'type_property');
    expect(type.length).toBeGreaterThanOrEqual(2); // interface + type
  });

  it('detects string_literal references (accessor config)', () => {
    const refs = analyzeFile(FIXTURE, 'active_time_ms');
    const str = refs.filter(r => r.kind === 'string_literal');
    expect(str.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for non-existent field', () => {
    const refs = analyzeFile(FIXTURE, 'nonexistent_field_xyz');
    expect(refs).toHaveLength(0);
  });

  it('returns empty array for file with no matching field', () => {
    // Use a real file but search for a field that doesn't exist
    const refs = analyzeFile(path.join(FIXTURES_DIR, 'complexity-negative.ts'), 'nonexistent_field_xyz');
    expect(refs).toHaveLength(0);
  });

  it('includes file path and line number in each ref', () => {
    const refs = analyzeFile(FIXTURE, 'active_time_ms');
    for (const ref of refs) {
      expect(ref.file).toBeTruthy();
      expect(ref.line).toBeGreaterThan(0);
      expect(ref.kind).toBeTruthy();
      expect(ref.context).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// main() CLI
// ---------------------------------------------------------------------------

describe('main()', () => {
  let stdoutChunks: string[];
  let originalArgv: string[];

  beforeEach(() => {
    stdoutChunks = [];
    originalArgv = process.argv;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('--help exits 0', () => {
    process.argv = ['node', 'ast-field-refs.ts', '--help'];
    expect(() => main()).toThrow('process.exit(0)');
    expect(stdoutChunks.join('')).toContain('Usage:');
  });

  it('no --field exits 1', () => {
    process.argv = ['node', 'ast-field-refs.ts', FIXTURE];
    expect(() => main()).toThrow('process.exit(1)');
  });

  it('no paths exits 1', () => {
    process.argv = ['node', 'ast-field-refs.ts', '--field', 'active_time_ms'];
    expect(() => main()).toThrow('process.exit(1)');
  });

  it('non-existent path exits 1', () => {
    process.argv = ['node', 'ast-field-refs.ts', '/tmp/nonexistent-12345', '--field', 'foo'];
    expect(() => main()).toThrow('process.exit(1)');
  });

  it('valid file produces JSON output', () => {
    process.argv = ['node', 'ast-field-refs.ts', FIXTURE, '--field', 'active_time_ms'];
    main();
    const result = JSON.parse(stdoutChunks.join(''));
    expect(result.field).toBe('active_time_ms');
    expect(result.totalRefs).toBeGreaterThan(0);
    expect(result.fileCount).toBe(1);
    expect(result.files).toHaveLength(1);
  });

  it('--pretty produces indented JSON', () => {
    process.argv = ['node', 'ast-field-refs.ts', FIXTURE, '--field', 'active_time_ms', '--pretty'];
    main();
    const output = stdoutChunks.join('');
    expect(output).toContain('\n  '); // indented
    expect(JSON.parse(output).field).toBe('active_time_ms');
  });
});
