import { describe, it, expect } from 'vitest';
import path from 'path';
import { buildDependencyGraph, isBarrelFile, traceBarrelChain, extractImportObservations } from '../ast-imports';
import { PROJECT_ROOT } from '../project';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function fixtureRelative(name: string): string {
  return path.relative(PROJECT_ROOT, fixturePath(name));
}

describe('ast-imports', () => {
  describe('basic imports', () => {
    it('extracts imports from simple-component.tsx', () => {
      const graph = buildDependencyGraph(fixturePath('simple-component.tsx'), {
        searchDir: FIXTURES_DIR,
      });

      const targetFile = graph.files.find(f => f.relativePath.endsWith('simple-component.tsx'));
      expect(targetFile).toBeDefined();
      expect(targetFile!.imports.length).toBeGreaterThanOrEqual(1);

      const reactImport = targetFile!.imports.find(i => i.source === 'react');
      expect(reactImport).toBeDefined();
      expect(reactImport!.specifiers).toContain('React');
    });

    it('extracts imports from component-with-effects.tsx', () => {
      const graph = buildDependencyGraph(fixturePath('component-with-effects.tsx'), { searchDir: FIXTURES_DIR });

      const targetFile = graph.files.find(f => f.relativePath.endsWith('component-with-effects.tsx'));
      expect(targetFile).toBeDefined();

      const reactImport = targetFile!.imports.find(i => i.source === 'react');
      expect(reactImport).toBeDefined();
      expect(reactImport!.specifiers).toContain('useState');
      expect(reactImport!.specifiers).toContain('useEffect');
      expect(reactImport!.specifiers).toContain('useRef');
    });
  });

  describe('exports', () => {
    it('classifies function exports correctly', () => {
      const graph = buildDependencyGraph(fixturePath('simple-component.tsx'), { searchDir: FIXTURES_DIR });

      const targetFile = graph.files.find(f => f.relativePath.endsWith('simple-component.tsx'));
      expect(targetFile).toBeDefined();

      const buttonExport = targetFile!.exports.find(e => e.name === 'Button');
      expect(buttonExport).toBeDefined();
      expect(buttonExport!.kind).toBe('function');
      expect(buttonExport!.isTypeOnly).toBe(false);
    });

    it('classifies const exports correctly', () => {
      const graph = buildDependencyGraph(fixturePath('dead-export.ts'), {
        searchDir: FIXTURES_DIR,
      });

      const targetFile = graph.files.find(f => f.relativePath.endsWith('dead-export.ts'));
      expect(targetFile).toBeDefined();

      const constExport = targetFile!.exports.find(e => e.name === 'USED_CONST');
      expect(constExport).toBeDefined();
      expect(constExport!.kind).toBe('const');
    });

    it('classifies multiple export kinds from module-with-types', () => {
      const graph = buildDependencyGraph(fixturePath('module-with-types.ts'), { searchDir: FIXTURES_DIR });

      const targetFile = graph.files.find(f => f.relativePath.endsWith('module-with-types.ts'));
      expect(targetFile).toBeDefined();

      const functionNames = [
        'unsafeParse',
        'doubleCast',
        'assertDefined',
        'acceptsAnything',
        'tryCatchAny',
        'createUserId',
      ];
      for (const name of functionNames) {
        const exp = targetFile!.exports.find(e => e.name === name);
        expect(exp, `Expected export ${name}`).toBeDefined();
        expect(exp!.kind).toBe('function');
      }
    });
  });

  describe('type-only imports', () => {
    it('marks type-only imports correctly', () => {
      const graph = buildDependencyGraph(fixturePath('type-only-imports.ts'), { searchDir: FIXTURES_DIR });

      const targetFile = graph.files.find(f => f.relativePath.endsWith('type-only-imports.ts'));
      expect(targetFile).toBeDefined();

      const typeImport = targetFile!.imports.find(i => i.source.includes('types'));
      expect(typeImport).toBeDefined();
      expect(typeImport!.isTypeOnly).toBe(true);
      expect(typeImport!.specifiers).toContain('ExportInfo');
      expect(typeImport!.specifiers).toContain('ImportInfo');
    });
  });

  describe('barrel re-exports', () => {
    it('tracks re-exports in barrel file with resolved kinds', () => {
      const graph = buildDependencyGraph(fixturePath('barrel-reexport.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const barrelFile = graph.files.find(f => f.relativePath.endsWith('barrel-reexport.ts'));
      expect(barrelFile).toBeDefined();

      // Named re-exports now resolve to their source declaration kind
      // (e.g., 'function' instead of 'reexport') via resolveNamedExportKind
      expect(barrelFile!.exports.length).toBeGreaterThanOrEqual(4);

      const buttonExport = barrelFile!.exports.find(e => e.name === 'Button');
      expect(buttonExport).toBeDefined();
      expect(buttonExport!.kind).toBe('function');
    });

    it('creates edges from barrel to source files', () => {
      const graph = buildDependencyGraph(fixturePath('barrel-reexport.ts'), { searchDir: FIXTURES_DIR });

      const barrelRelPath = fixtureRelative('barrel-reexport.ts');
      const barrelEdges = graph.edges.filter(e => e.from === barrelRelPath);
      expect(barrelEdges.length).toBeGreaterThanOrEqual(3);

      const toSimpleComponent = barrelEdges.find(e => e.to.endsWith('simple-component.tsx'));
      expect(toSimpleComponent).toBeDefined();
      expect(toSimpleComponent!.specifiers).toContain('Button');
    });
  });

  describe('star re-exports', () => {
    it('records star re-export entries', () => {
      const graph = buildDependencyGraph(fixturePath('star-reexport.ts'), { searchDir: FIXTURES_DIR });

      const starFile = graph.files.find(f => f.relativePath.endsWith('star-reexport.ts'));
      expect(starFile).toBeDefined();

      const starExports = starFile!.exports.filter(e => e.name.startsWith('* from'));
      expect(starExports.length).toBe(2);
      expect(starExports[0].kind).toBe('reexport');
    });
  });

  describe('namespace imports', () => {
    it('records namespace import specifiers', () => {
      const graph = buildDependencyGraph(fixturePath('namespace-import.ts'), { searchDir: FIXTURES_DIR });

      const nsFile = graph.files.find(f => f.relativePath.endsWith('namespace-import.ts'));
      expect(nsFile).toBeDefined();

      const nsImport = nsFile!.imports.find(i => i.source.includes('module-with-types'));
      expect(nsImport).toBeDefined();
      expect(nsImport!.specifiers).toContain('* as Types');
    });
  });

  describe('side-effect imports', () => {
    it('records side-effect imports with empty specifiers', () => {
      const graph = buildDependencyGraph(fixturePath('side-effect-import.ts'), { searchDir: FIXTURES_DIR });

      const sideEffectFile = graph.files.find(f => f.relativePath.endsWith('side-effect-import.ts'));
      expect(sideEffectFile).toBeDefined();

      const sideEffectImport = sideEffectFile!.imports.find(i => i.source.includes('circular-a'));
      expect(sideEffectImport).toBeDefined();
      expect(sideEffectImport!.specifiers).toEqual([]);
    });
  });

  describe('dynamic imports', () => {
    it('detects dynamic import() calls', () => {
      const graph = buildDependencyGraph(fixturePath('dynamic-import.ts'), { searchDir: FIXTURES_DIR });

      const dynFile = graph.files.find(f => f.relativePath.endsWith('dynamic-import.ts'));
      expect(dynFile).toBeDefined();

      const dynamicImports = dynFile!.imports.filter(i => i.specifiers.includes('*'));
      expect(dynamicImports.length).toBe(2);
    });
  });

  describe('circular dependency detection', () => {
    it('detects cycles between circular-a and circular-b', { timeout: 120_000 }, () => {
      const graph = buildDependencyGraph(FIXTURES_DIR, {
        searchDir: FIXTURES_DIR,
      });

      expect(graph.circularDeps.length).toBeGreaterThan(0);

      // At least one cycle should contain both circular-a and circular-b
      const hasCycle = graph.circularDeps.some(
        cycle => cycle.some(p => p.includes('circular-a')) && cycle.some(p => p.includes('circular-b')),
      );
      expect(hasCycle).toBe(true);
    });
  });

  describe('dead export detection', () => {
    it('identifies unused exports', () => {
      // Analyze the dead-export.ts and dead-export-consumer.ts together
      const graph = buildDependencyGraph(fixturePath('dead-export.ts'), { searchDir: FIXTURES_DIR });

      // unusedFunction and UNUSED_CONST should be dead
      const deadNames = graph.deadExports.map(d => d.export);
      expect(deadNames).toContain('unusedFunction');
      expect(deadNames).toContain('UNUSED_CONST');
    });

    it('does not flag consumed exports as dead', () => {
      const graph = buildDependencyGraph(fixturePath('dead-export.ts'), { searchDir: FIXTURES_DIR });

      const deadNames = graph.deadExports.map(d => d.export);
      expect(deadNames).not.toContain('usedFunction');
      expect(deadNames).not.toContain('USED_CONST');
    });
  });

  describe('edge graph', () => {
    it('creates edges for resolved imports', () => {
      const graph = buildDependencyGraph(fixturePath('barrel-reexport.ts'), { searchDir: FIXTURES_DIR });

      expect(graph.edges.length).toBeGreaterThan(0);

      // Every edge should have from, to, and specifiers
      for (const edge of graph.edges) {
        expect(edge.from).toBeDefined();
        expect(edge.to).toBeDefined();
        expect(edge.specifiers).toBeDefined();
        expect(Array.isArray(edge.specifiers)).toBe(true);
      }
    });
  });

  describe('isBarrelFile', () => {
    it('identifies index.ts as a barrel', () => {
      expect(isBarrelFile('/some/path/index.ts')).toBe(true);
    });

    it('identifies index.tsx as a barrel', () => {
      expect(isBarrelFile('/some/path/index.tsx')).toBe(true);
    });

    it('does not flag non-index files', () => {
      expect(isBarrelFile('/some/path/utils.ts')).toBe(false);
    });
  });

  describe('traceBarrelChain', () => {
    it('traces re-export chain through barrel file', () => {
      const barrelPath = fixturePath('barrel-reexport.ts');
      const chain = traceBarrelChain('Button', barrelPath);

      expect(chain.length).toBeGreaterThanOrEqual(2);
      expect(chain[0]).toBe(barrelPath);
      expect(chain.some(p => p.includes('simple-component'))).toBe(true);
    });
  });

  describe('output structure', () => {
    it('conforms to DependencyGraph interface', () => {
      const graph = buildDependencyGraph(fixturePath('simple-component.tsx'), { searchDir: FIXTURES_DIR });

      expect(graph).toHaveProperty('files');
      expect(graph).toHaveProperty('edges');
      expect(graph).toHaveProperty('circularDeps');
      expect(graph).toHaveProperty('deadExports');

      expect(Array.isArray(graph.files)).toBe(true);
      expect(Array.isArray(graph.edges)).toBe(true);
      expect(Array.isArray(graph.circularDeps)).toBe(true);
      expect(Array.isArray(graph.deadExports)).toBe(true);
    });

    it('each file node has required fields', () => {
      const graph = buildDependencyGraph(fixturePath('simple-component.tsx'), { searchDir: FIXTURES_DIR });

      for (const file of graph.files) {
        expect(file).toHaveProperty('path');
        expect(file).toHaveProperty('relativePath');
        expect(file).toHaveProperty('imports');
        expect(file).toHaveProperty('exports');
        expect(typeof file.path).toBe('string');
        expect(typeof file.relativePath).toBe('string');
        expect(Array.isArray(file.imports)).toBe(true);
        expect(Array.isArray(file.exports)).toBe(true);
      }
    });
  });

  describe('real file smoke test', () => {
    it('analyzes typedStorage.ts and produces valid output', () => {
      const graph = buildDependencyGraph('src/shared/utils/typedStorage.ts');

      expect(graph.files.length).toBeGreaterThan(0);

      const targetFile = graph.files.find(f => f.relativePath.includes('typedStorage'));
      expect(targetFile).toBeDefined();
      expect(targetFile!.imports.length).toBeGreaterThan(0);
      expect(targetFile!.exports.length).toBeGreaterThan(0);

      // Output should be serializable to JSON
      const json = JSON.stringify(graph);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  describe('negative fixture', () => {
    it('produces zero observations for isolated file', () => {
      const graph = buildDependencyGraph(fixturePath('imports-negative.ts'), { searchDir: FIXTURES_DIR });
      const result = extractImportObservations(graph);

      // File with no imports and no exports should produce zero observations
      const fileObs = result.observations.filter(o => o.file.endsWith('imports-negative.ts'));
      expect(fileObs).toHaveLength(0);
    });
  });

  describe('extractImportObservations', () => {
    it('extracts observations from a dependency graph', () => {
      const graph = buildDependencyGraph(fixturePath('simple-component.tsx'), { searchDir: FIXTURES_DIR });
      const result = extractImportObservations(graph);

      expect(result.observations.length).toBeGreaterThan(0);
      expect(result.filePath).toBeDefined();
    });

    it('creates STATIC_IMPORT observations for regular imports', () => {
      const graph = buildDependencyGraph(fixturePath('simple-component.tsx'), { searchDir: FIXTURES_DIR });
      const result = extractImportObservations(graph);

      const staticImports = result.observations.filter(o => o.kind === 'STATIC_IMPORT');
      expect(staticImports.length).toBeGreaterThan(0);

      const firstImport = staticImports[0];
      expect(firstImport.evidence.source).toBeDefined();
      expect(firstImport.evidence.specifiers).toBeDefined();
      expect(firstImport.line).toBeGreaterThan(0);
    });

    it('creates EXPORT_DECLARATION observations for exports', () => {
      const graph = buildDependencyGraph(fixturePath('simple-component.tsx'), { searchDir: FIXTURES_DIR });
      const result = extractImportObservations(graph);

      const exports = result.observations.filter(o => o.kind === 'EXPORT_DECLARATION');
      expect(exports.length).toBeGreaterThan(0);

      const firstExport = exports[0];
      expect(firstExport.evidence.exportName).toBeDefined();
      expect(firstExport.evidence.exportKind).toBeDefined();
    });

    it('creates DEAD_EXPORT_CANDIDATE observations for dead exports', () => {
      const graph = buildDependencyGraph(fixturePath('dead-export.ts'), { searchDir: FIXTURES_DIR });
      const result = extractImportObservations(graph);

      const deadExports = result.observations.filter(o => o.kind === 'DEAD_EXPORT_CANDIDATE');
      expect(deadExports.length).toBeGreaterThan(0);

      const firstDead = deadExports[0];
      expect(firstDead.evidence.exportName).toBeDefined();
      expect(firstDead.evidence.consumerCount).toBe(0);
    });

    it('creates CIRCULAR_DEPENDENCY observations for circular deps', () => {
      const graph = buildDependencyGraph(FIXTURES_DIR, { searchDir: FIXTURES_DIR });
      const result = extractImportObservations(graph);

      const circularDeps = result.observations.filter(o => o.kind === 'CIRCULAR_DEPENDENCY');
      // Should have at least one circular dependency from circular-a/circular-b
      expect(circularDeps.length).toBeGreaterThan(0);

      const firstCycle = circularDeps[0];
      expect(firstCycle.evidence.cyclePath).toBeDefined();
      expect(Array.isArray(firstCycle.evidence.cyclePath)).toBe(true);
    });
  });

  describe('resolveNamedExportKind (via buildDependencyGraph)', () => {
    it('resolves named re-export kind through a 1-level chain', () => {
      const graph = buildDependencyGraph(fixturePath('reexport-chain-middle.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const middleFile = graph.files.find(f => f.relativePath.endsWith('reexport-chain-middle.ts'));
      expect(middleFile).toBeDefined();

      const fnExport = middleFile!.exports.find(e => e.name === 'chainedFunction');
      expect(fnExport).toBeDefined();
      expect(fnExport!.kind).toBe('function');
      expect(fnExport!.isTypeOnly).toBe(false);

      const typeExport = middleFile!.exports.find(e => e.name === 'ChainedType');
      expect(typeExport).toBeDefined();
      expect(typeExport!.kind).toBe('type');
      expect(typeExport!.isTypeOnly).toBe(true);
    });

    it('resolves named re-export kind through a 2-level chain', () => {
      const graph = buildDependencyGraph(fixturePath('reexport-chain-top.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const topFile = graph.files.find(f => f.relativePath.endsWith('reexport-chain-top.ts'));
      expect(topFile).toBeDefined();

      const fnExport = topFile!.exports.find(e => e.name === 'chainedFunction');
      expect(fnExport).toBeDefined();
      expect(fnExport!.kind).toBe('function');

      const typeExport = topFile!.exports.find(e => e.name === 'ChainedType');
      expect(typeExport).toBeDefined();
      expect(typeExport!.kind).toBe('type');
    });

    it('resolves default re-export through a chain', () => {
      const graph = buildDependencyGraph(fixturePath('reexport-chain-middle.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const middleFile = graph.files.find(f => f.relativePath.endsWith('reexport-chain-middle.ts'));
      expect(middleFile).toBeDefined();

      const defaultExport = middleFile!.exports.find(e => e.name === 'default');
      expect(defaultExport).toBeDefined();
      // resolveNamedExportKind follows the chain to the source declaration
      // (export default function), so kind is 'function' not 'default'
      expect(defaultExport!.kind).toBe('function');
    });

    it('resolves names transitively through star re-exports', () => {
      const graph = buildDependencyGraph(fixturePath('reexport-star-transitive.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const starFile = graph.files.find(f => f.relativePath.endsWith('reexport-star-transitive.ts'));
      expect(starFile).toBeDefined();

      // chainedFunction should be resolved via export * -> reexport-chain-source
      const fnExport = starFile!.exports.find(e => e.name === 'chainedFunction');
      expect(fnExport).toBeDefined();
      expect(fnExport!.kind).toBe('function');

      const typeExport = starFile!.exports.find(e => e.name === 'ChainedType');
      expect(typeExport).toBeDefined();
      expect(typeExport!.kind).toBe('type');
    });
  });

  describe('namespace re-exports', () => {
    it('creates a single named export per namespace re-export', () => {
      const graph = buildDependencyGraph(fixturePath('reexport-namespace.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const nsFile = graph.files.find(f => f.relativePath.endsWith('reexport-namespace.ts'));
      expect(nsFile).toBeDefined();

      const chainSourceNs = nsFile!.exports.find(e => e.name === 'ChainSource');
      expect(chainSourceNs).toBeDefined();
      expect(chainSourceNs!.kind).toBe('const');
      expect(chainSourceNs!.isTypeOnly).toBe(false);

      const typesNs = nsFile!.exports.find(e => e.name === 'Types');
      expect(typesNs).toBeDefined();
      expect(typesNs!.kind).toBe('const');
    });

    it('does not produce star entries for namespace re-exports', () => {
      const graph = buildDependencyGraph(fixturePath('reexport-namespace.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const nsFile = graph.files.find(f => f.relativePath.endsWith('reexport-namespace.ts'));
      expect(nsFile).toBeDefined();

      const starExports = nsFile!.exports.filter(e => e.name.startsWith('* from'));
      expect(starExports).toHaveLength(0);
    });
  });

  describe('destructured exports', () => {
    it('extracts individual names from destructured const export', () => {
      const graph = buildDependencyGraph(fixturePath('destructured-exports.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const file = graph.files.find(f => f.relativePath.endsWith('destructured-exports.ts'));
      expect(file).toBeDefined();

      const names = file!.exports.map(e => e.name);
      expect(names).toContain('host');
      expect(names).toContain('port');
      expect(names).toContain('debug');
      expect(names).toContain('REGULAR');
    });

    it('classifies destructured exports as const', () => {
      const graph = buildDependencyGraph(fixturePath('destructured-exports.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const file = graph.files.find(f => f.relativePath.endsWith('destructured-exports.ts'));
      expect(file).toBeDefined();

      for (const name of ['host', 'port', 'debug']) {
        const exp = file!.exports.find(e => e.name === name);
        expect(exp, `Expected export ${name}`).toBeDefined();
        expect(exp!.kind).toBe('const');
      }
    });
  });

  describe('declaration merging deduplication', () => {
    it('produces one export entry per merged name, not two', () => {
      const graph = buildDependencyGraph(fixturePath('declaration-merging.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const file = graph.files.find(f => f.relativePath.endsWith('declaration-merging.ts'));
      expect(file).toBeDefined();

      const statusExports = file!.exports.filter(e => e.name === 'Status');
      expect(statusExports).toHaveLength(1);
      // First declaration (type) wins; const declaration is deduplicated away
      expect(statusExports[0].kind).toBe('type');

      const directionExports = file!.exports.filter(e => e.name === 'Direction');
      expect(directionExports).toHaveLength(1);
      expect(directionExports[0].kind).toBe('type');
    });
  });

  describe('JSX consumer tracing', () => {
    it('populates jsxElementNames for files that render components', () => {
      const graph = buildDependencyGraph(fixturePath('jsx-consumer-tracing.tsx'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const file = graph.files.find(f => f.relativePath.endsWith('jsx-consumer-tracing.tsx'));
      expect(file).toBeDefined();
      expect(file!.jsxElementNames).toBeDefined();
      expect(file!.jsxElementNames).toContain('Button');
    });

    it('does not include lowercase intrinsic elements in jsxElementNames', () => {
      const graph = buildDependencyGraph(fixturePath('jsx-consumer-tracing.tsx'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const file = graph.files.find(f => f.relativePath.endsWith('jsx-consumer-tracing.tsx'));
      expect(file).toBeDefined();
      expect(file!.jsxElementNames).toBeDefined();

      // div and h1 are intrinsic -- must not appear
      for (const name of file!.jsxElementNames!) {
        expect(name[0]).toBe(name[0].toUpperCase());
      }
    });

    it('does not populate jsxElementNames for import-only files', () => {
      const graph = buildDependencyGraph(fixturePath('jsx-consumer-import-only.ts'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const file = graph.files.find(f => f.relativePath.endsWith('jsx-consumer-import-only.ts'));
      expect(file).toBeDefined();
      // No JSX in this file, so jsxElementNames should be absent
      expect(file!.jsxElementNames).toBeUndefined();
    });

    it('simple-component.tsx has jsxElementNames omitted for intrinsic-only JSX', () => {
      const graph = buildDependencyGraph(fixturePath('simple-component.tsx'), {
        searchDir: FIXTURES_DIR,
        noCache: true,
      });

      const file = graph.files.find(f => f.relativePath.endsWith('simple-component.tsx'));
      expect(file).toBeDefined();
      // simple-component.tsx only renders <button>, which is intrinsic
      expect(file!.jsxElementNames).toBeUndefined();
    });
  });
});
