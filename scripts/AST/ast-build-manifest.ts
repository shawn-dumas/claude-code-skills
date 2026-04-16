import path from 'path';
import fs from 'fs';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT, getSourceFile } from './project';
import { analyzeReactFile } from './ast-react-inventory';
import { analyzeDataLayer } from './ast-data-layer';
import type { HookCall, PropField } from './types';

type StructuralKind = 'component' | 'hook' | 'mixed' | 'utility';

export interface BuildManifest {
  readonly file: string;
  readonly structuralKind: StructuralKind;
  readonly exports: { readonly name: string; readonly kind: string; readonly line: number }[];
  readonly primaryComponent?: {
    readonly name: string;
    readonly line: number;
    readonly props: readonly PropField[];
  };
  readonly hookCalls: readonly HookCall[];
  readonly dataLayer: {
    readonly queryHooks: readonly { readonly name: string; readonly line: number }[];
    readonly mutationHooks: readonly { readonly name: string; readonly line: number }[];
    readonly fetchApiCalls: readonly { readonly endpoint: string; readonly line: number }[];
  };
  readonly imports: readonly { readonly module: string; readonly named: readonly string[] }[];
}

function classifyStructurally(filePath: string, componentCount: number, hookOnlyCount: number): StructuralKind {
  const isHookFile = /\/use[A-Z]/.test(filePath);
  if (componentCount === 0 && hookOnlyCount === 0) return 'utility';
  if (componentCount === 0 && hookOnlyCount > 0) return 'hook';
  if (isHookFile && hookOnlyCount > 0) return 'hook';
  if (componentCount > 0 && hookOnlyCount === 0) return 'component';
  return 'mixed';
}

function extractExports(filePath: string): BuildManifest['exports'] {
  const sf = getSourceFile(filePath);
  const exports: { name: string; kind: string; line: number }[] = [];

  for (const [name, nodes] of sf.getExportedDeclarations().entries()) {
    if (nodes.length === 0) continue;
    const node = nodes[0];
    exports.push({ name, kind: node.getKindName(), line: node.getStartLineNumber() });
  }
  return exports;
}

function extractImports(filePath: string): BuildManifest['imports'] {
  const sf = getSourceFile(filePath);
  return sf.getImportDeclarations().map(decl => ({
    module: decl.getModuleSpecifierValue(),
    named: decl.getNamedImports().map(i => i.getName()),
  }));
}

export function buildManifest(filePath: string): BuildManifest {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Path does not exist: ${filePath}`);
  }

  const inventory = analyzeReactFile(absolute);
  const dataLayer = analyzeDataLayer(absolute);

  const componentEntries = inventory.components.filter(c => c.kind !== 'hook');
  const hookEntries = inventory.components.filter(c => c.kind === 'hook');
  const primaryComponent = componentEntries[0];

  const allHookCalls = inventory.components.flatMap(c => c.hookCalls);

  const queryHooks = dataLayer.usages
    .filter(u => u.type === 'QUERY_HOOK_DEF')
    .map(u => ({ name: u.name, line: u.line }));
  const mutationHooks = dataLayer.usages
    .filter(u => u.type === 'MUTATION_HOOK_DEF')
    .map(u => ({ name: u.name, line: u.line }));
  const fetchApiCalls = dataLayer.usages
    .filter(u => u.type === 'FETCH_API_CALL')
    .map(u => ({ endpoint: u.text, line: u.line }));

  return {
    file: path.relative(PROJECT_ROOT, absolute),
    structuralKind: classifyStructurally(absolute, componentEntries.length, hookEntries.length),
    exports: extractExports(absolute),
    primaryComponent: primaryComponent
      ? { name: primaryComponent.name, line: primaryComponent.line, props: primaryComponent.props }
      : undefined,
    hookCalls: allHookCalls,
    dataLayer: { queryHooks, mutationHooks, fetchApiCalls },
    imports: extractImports(absolute),
  };
}

export function main(): void {
  const args = parseArgs(process.argv);
  if (args.help || args.paths.length === 0) {
    process.stdout.write(
      'Usage: ast-build-manifest <path> [--pretty]\n' +
        '\n' +
        'Emits a structural constraint manifest for build-* skills: structural\n' +
        'kind (component/hook/mixed/utility), exports, primary component props,\n' +
        'hook calls, data-layer usages, and imports.\n' +
        '\n' +
        'Consumed by build-react-test and related skills as authoritative\n' +
        'input, replacing ad-hoc file inventory. Ownership classification\n' +
        '(CONTAINER vs DDAU_COMPONENT) remains the job of ast-interpret-ownership;\n' +
        "this tool supplies the raw structural facts the interpreter doesn't.\n",
    );
    process.exit(args.help ? 0 : 1);
  }

  const manifests: BuildManifest[] = [];
  for (const p of args.paths) {
    try {
      manifests.push(buildManifest(p));
    } catch (err) {
      fatal(`failed: ${p}: ${(err as Error).message}`);
    }
  }

  output({ manifests }, args.pretty);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
