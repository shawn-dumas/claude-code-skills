import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT, getSourceFile } from './project';
import { analyzeReactFile } from './ast-react-inventory';
import { analyzeDataLayer } from './ast-data-layer';
import type { HookCall, PropField } from './types';

export const HookCallSchema = z.object({
  name: z.string(),
  line: z.number(),
  column: z.number(),
  parentFunction: z.string(),
  destructuredNames: z.array(z.string()),
});

export const PropFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  optional: z.boolean(),
  hasDefault: z.boolean(),
  isCallback: z.boolean(),
});

// Compile-time guards: the Zod schemas above must match the canonical
// interfaces in types.ts exactly. If anyone adds, removes, or retypes a
// field on either side without updating the other, tsc fails at the
// assignment below. This prevents silent schema/type drift (tools strip
// or reject fields at runtime that the interface still advertises, or
// vice versa). Each guard asserts two-way assignability by casting a
// value-shape through both directions.
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _HOOK_CALL_PARITY: AssertEqual<HookCall, z.infer<typeof HookCallSchema>> = true;
const _PROP_FIELD_PARITY: AssertEqual<PropField, z.infer<typeof PropFieldSchema>> = true;
// Reference the constants so unused-locals/exports don't strip them.
void _HOOK_CALL_PARITY;
void _PROP_FIELD_PARITY;

export const StructuralKindSchema = z.enum(['component', 'hook', 'mixed', 'utility']);

export const BuildManifestSchema = z.object({
  file: z.string(),
  structuralKind: StructuralKindSchema,
  exports: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      line: z.number(),
    }),
  ),
  primaryComponent: z
    .object({
      name: z.string(),
      line: z.number(),
      props: z.array(PropFieldSchema),
    })
    .optional(),
  hookCalls: z.array(HookCallSchema),
  dataLayer: z.object({
    queryHooks: z.array(z.object({ name: z.string(), line: z.number() })),
    mutationHooks: z.array(z.object({ name: z.string(), line: z.number() })),
    fetchApiCalls: z.array(z.object({ endpoint: z.string(), line: z.number() })),
  }),
  imports: z.array(
    z.object({
      module: z.string(),
      named: z.array(z.string()),
    }),
  ),
});

export type BuildManifest = z.infer<typeof BuildManifestSchema>;

type StructuralKind = z.infer<typeof StructuralKindSchema>;

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

  const candidate = {
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
  const parsed = BuildManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    // This fires only when an upstream analyzer (ast-react-inventory,
    // ast-data-layer, extractExports/extractImports) drifts from the
    // manifest schema. The compile-time parity guards at the top of this
    // file catch shape mismatches at the HookCall/PropField layer, but
    // everything else relies on this runtime check.
    throw new Error(`manifest schema validation failed for ${filePath}: ${parsed.error.message}`);
  }
  return parsed.data;
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
