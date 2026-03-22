import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const currentFilePath = fileURLToPath(import.meta.url);
const SCRIPTS_AST_DIR = path.dirname(currentFilePath);
const PROJECT_ROOT = path.resolve(SCRIPTS_AST_DIR, '../..');

// ---------------------------------------------------------------------------
// Route types
// ---------------------------------------------------------------------------

interface StandardRoute {
  tool: string;
  flags: string[];
}

interface UnroutableTool {
  invocation: string;
}

// ---------------------------------------------------------------------------
// Standard routes: query-type -> { tool, flags }
// ---------------------------------------------------------------------------

const ROUTES: ReadonlyMap<string, StandardRoute> = new Map([
  // Import graph
  ['imports', { tool: 'ast-imports', flags: [] }],
  ['dead-exports', { tool: 'ast-imports', flags: ['--kind', 'DEAD_EXPORT_CANDIDATE'] }],
  ['circular', { tool: 'ast-imports', flags: ['--kind', 'CIRCULAR_DEPENDENCY'] }],

  // Date usage
  ['date-usage', { tool: 'ast-date-handling', flags: [] }],
  ['date-summary', { tool: 'ast-date-handling', flags: ['--summary'] }],

  // Side effects
  ['side-effects', { tool: 'ast-side-effects', flags: [] }],

  // Type safety
  ['type-safety', { tool: 'ast-type-safety', flags: [] }],
  ['as-any', { tool: 'ast-type-safety', flags: ['--kind', 'AS_ANY_CAST'] }],

  // React inventory
  ['hooks', { tool: 'ast-react-inventory', flags: ['--kind', 'HOOK_CALL'] }],
  ['effects', { tool: 'ast-react-inventory', flags: ['--kind', 'EFFECT_LOCATION'] }],

  // Complexity
  ['complexity', { tool: 'ast-complexity', flags: [] }],

  // JSX
  ['jsx', { tool: 'ast-jsx-analysis', flags: [] }],

  // Authorization
  ['authz', { tool: 'ast-authz-audit', flags: [] }],

  // Testing
  ['test-quality', { tool: 'ast-test-analysis', flags: [] }],
  ['test-coverage', { tool: 'ast-test-coverage', flags: [] }],
  ['pw-parity', { tool: 'ast-pw-test-parity', flags: [] }],
  ['vitest-parity', { tool: 'ast-vitest-parity', flags: [] }],

  // Data layer
  ['data-layer', { tool: 'ast-data-layer', flags: [] }],

  // Handler structure
  ['handler', { tool: 'ast-handler-structure', flags: [] }],

  // Type system
  ['branded', { tool: 'ast-branded-check', flags: [] }],

  // Environment / config
  ['env', { tool: 'ast-env-access', flags: [] }],
  ['feature-flags', { tool: 'ast-feature-flags', flags: [] }],
  ['storage', { tool: 'ast-storage-access', flags: [] }],

  // Display
  ['null-display', { tool: 'ast-null-display', flags: [] }],
  ['number-format', { tool: 'ast-number-format', flags: [] }],

  // Architectural
  ['concerns', { tool: 'ast-concern-matrix', flags: [] }],
  ['errors', { tool: 'ast-error-coverage', flags: [] }],
  ['exports', { tool: 'ast-export-surface', flags: [] }],
  ['behavioral', { tool: 'ast-behavioral', flags: [] }],

  // Interpreters
  ['interpret-effects', { tool: 'ast-interpret-effects', flags: [] }],
  ['interpret-hooks', { tool: 'ast-interpret-hooks', flags: [] }],
  ['interpret-ownership', { tool: 'ast-interpret-ownership', flags: [] }],
  ['interpret-template', { tool: 'ast-interpret-template', flags: [] }],
  ['interpret-test-quality', { tool: 'ast-interpret-test-quality', flags: [] }],
  ['interpret-dead-code', { tool: 'ast-interpret-dead-code', flags: [] }],
  ['interpret-plan-audit', { tool: 'ast-interpret-plan-audit', flags: [] }],
  ['interpret-display', { tool: 'ast-interpret-display-format', flags: [] }],
  ['interpret-intent', { tool: 'ast-interpret-refactor-intent', flags: [] }],
  ['interpret-parity', { tool: 'ast-interpret-pw-test-parity', flags: [] }],
  ['interpret-vitest', { tool: 'ast-interpret-vitest-parity', flags: [] }],
  ['interpret-test-coverage', { tool: 'ast-interpret-test-coverage', flags: [] }],
  ['interpret-skill', { tool: 'ast-interpret-skill-quality', flags: [] }],
]);

// ---------------------------------------------------------------------------
// Arg-rewriting routes (special cases, not in ROUTES)
// ---------------------------------------------------------------------------

const ARG_REWRITE_QUERY_TYPES = new Set(['consumers', 'symbol']);

// ---------------------------------------------------------------------------
// Known unroutable tools
// ---------------------------------------------------------------------------

const KNOWN_UNROUTABLE: ReadonlyMap<string, UnroutableTool> = new Map([
  ['bff-gaps', { invocation: 'npx tsx scripts/AST/ast-bff-gaps.ts (no args)' }],
  ['field-refs', { invocation: 'npx tsx scripts/AST/ast-field-refs.ts <path> --field <name>' }],
  ['peer-deps', { invocation: 'npx tsx scripts/AST/ast-peer-deps.ts (no args)' }],
  ['plan-audit', { invocation: 'npx tsx scripts/AST/ast-plan-audit.ts <plan.md>' }],
  ['skill-analysis', { invocation: 'npx tsx scripts/AST/ast-skill-analysis.ts <SKILL.md>' }],
  ['refactor-intent', { invocation: 'npx tsx scripts/AST/ast-refactor-intent.ts --before <dir> --after <dir>' }],
]);

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `Usage: npx tsx scripts/AST/ast-query.ts <query-type> <path...> [flags]

Available query types:

  Import/consumer tracing:
    imports        Find import/export declarations
    consumers      Find all files that import a given file
    symbol         Find all files that import a specific symbol
    dead-exports   Find exports with no consumers
    circular       Find circular dependency chains

  Date usage:
    date-usage     Classify date operations (raw vs Temporal)
    date-summary   Summary stats of raw/proper ratio by layer

  Side effects:
    side-effects   Find console, TODO, storage, DOM side effects

  Type safety:
    type-safety    All type safety observations
    as-any         Find \`as any\` casts specifically

  React inventory:
    hooks          Find hook call sites
    effects        Find useEffect locations

  Complexity:
    complexity     Cyclomatic complexity per function

  JSX analysis:
    jsx            JSX return complexity, ternary chains, inline handlers

  Authorization:
    authz          Raw role checks and role equality outside canonical files

  Testing:
    test-quality   Test file structure (mocks, assertions, cleanup)
    test-coverage  Production-to-spec file mapping and risk scores
    pw-parity      Playwright spec structure and assertions
    vitest-parity  Vitest spec structure, mocks, renders

  Data layer:
    data-layer     Service hooks, query keys, fetchApi calls, endpoints

  Handler structure:
    handler        Inline handler logic, multi-method handlers

  Type system:
    branded        Unbranded ID fields and params

  Environment / config:
    env            process.env, clientEnv, serverEnv access
    feature-flags  PostHog feature flag usage and page guards
    storage        localStorage, sessionStorage, typedStorage, cookies

  Display:
    null-display   Null/empty display patterns, wrong placeholders
    number-format  Raw toFixed, toLocaleString, percentage display

  Architectural:
    concerns       Container loading/error/empty/permission handling
    errors         Query/mutation error handling coverage
    exports        Export surface from isolated files
    behavioral     Behavioral fingerprint (defaults, guards, literals)

  Interpreters:
    interpret-effects         Classify each useEffect
    interpret-hooks           Classify hook roles
    interpret-ownership       Classify container/component/leaf
    interpret-template        JSX complexity classification
    interpret-test-quality    Mock/assertion/cleanup classification
    interpret-dead-code       Dead export/circular dep classification
    interpret-plan-audit      Plan structure/prompt quality
    interpret-display         Display format classification
    interpret-intent          Refactor intention preservation
    interpret-parity          Playwright test parity
    interpret-vitest          Vitest test parity
    interpret-test-coverage   Test coverage gap classification
    interpret-skill           Skill file quality classification

  Unroutable (use direct invocation):
    bff-gaps         npx tsx scripts/AST/ast-bff-gaps.ts (no args)
    field-refs       npx tsx scripts/AST/ast-field-refs.ts <path> --field <name>
    peer-deps        npx tsx scripts/AST/ast-peer-deps.ts (no args)
    plan-audit       npx tsx scripts/AST/ast-plan-audit.ts <plan.md>
    skill-analysis   npx tsx scripts/AST/ast-skill-analysis.ts <SKILL.md>
    refactor-intent  npx tsx scripts/AST/ast-refactor-intent.ts --before <dir> --after <dir>

All flags (--pretty, --count, --kind, --no-cache, --test-files, --summary) pass through.

Examples:
  ast-query imports src/shared/utils/ --pretty
  ast-query consumers src/shared/utils/date/formatDate/formatDate.ts --pretty
  ast-query symbol BadRequestError src/ --pretty
  ast-query date-usage src/server/ --summary --pretty
  ast-query hooks src/ui/page_blocks/ --count
  ast-query complexity src/ui/page_blocks/ --pretty
`;

// ---------------------------------------------------------------------------
// Route validation
// ---------------------------------------------------------------------------

function validateRoutes(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [queryType, route] of ROUTES) {
    const toolPath = path.join(SCRIPTS_AST_DIR, `${route.tool}.ts`);
    if (!fs.existsSync(toolPath)) {
      errors.push(`ROUTES["${queryType}"]: tool file not found: ${toolPath}`);
    }
  }

  // Arg-rewriting routes target ast-imports
  const importsPath = path.join(SCRIPTS_AST_DIR, 'ast-imports.ts');
  if (!fs.existsSync(importsPath)) {
    errors.push('ARG_REWRITE: ast-imports.ts not found (needed by consumers, symbol)');
  }

  for (const [key] of KNOWN_UNROUTABLE) {
    const toolPath = path.join(SCRIPTS_AST_DIR, `ast-${key}.ts`);
    if (!fs.existsSync(toolPath)) {
      errors.push(`KNOWN_UNROUTABLE["${key}"]: tool file not found: ${toolPath}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Gap logging
// ---------------------------------------------------------------------------

function appendGap(queryType: string, gapsFilePath: string): void {
  const date = new Date().toISOString().slice(0, 10);
  const row = `| ${date} | ${queryType} | (auto-logged by ast-query) | ast-query ${queryType} | (auto-logged by ast-query) | open |\n`;
  fs.appendFileSync(gapsFilePath, row);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function runTool(toolName: string, args: string[]): void {
  const toolPath = path.join(SCRIPTS_AST_DIR, `${toolName}.ts`);
  const child = spawn('npx', ['tsx', toolPath, ...args], {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
  });

  child.on('close', code => {
    process.exit(code ?? 1);
  });

  child.on('error', err => {
    process.stderr.write(`Failed to spawn tool: ${err.message}\n`);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// CLI argument parsing (minimal, dispatcher-specific)
// ---------------------------------------------------------------------------

function parseDispatcherArgs(argv: string[]): {
  queryType: string | undefined;
  positionalArgs: string[];
  extraFlags: string[];
  help: boolean;
  list: boolean;
  validate: boolean;
} {
  const raw = argv.slice(2);
  let queryType: string | undefined;
  const positionalArgs: string[] = [];
  const extraFlags: string[] = [];
  let help = false;
  let list = false;
  let validate = false;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '--list') {
      list = true;
      continue;
    }
    if (arg === '--validate') {
      validate = true;
      continue;
    }

    if (arg.startsWith('--')) {
      // Named options consume the next arg as their value
      const namedOptions = ['--kind', '--source-branch', '--field', '--symbol', '--consumers', '--before', '--after'];
      if (namedOptions.includes(arg) && i + 1 < raw.length) {
        extraFlags.push(arg, raw[i + 1]);
        i++;
      } else {
        extraFlags.push(arg);
      }
      continue;
    }

    // First non-flag positional is the query type
    if (queryType === undefined) {
      queryType = arg;
    } else {
      positionalArgs.push(arg);
    }
  }

  return { queryType, positionalArgs, extraFlags, help, list, validate };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function main(
  argv: string[] = process.argv,
  gapsFilePath: string = path.join(SCRIPTS_AST_DIR, 'GAPS.md'),
): void {
  const { queryType, positionalArgs, extraFlags, help, list, validate } = parseDispatcherArgs(argv);

  // --validate (check before help so `--validate` alone works)
  if (validate) {
    const result = validateRoutes();
    if (result.valid) {
      process.stderr.write('All routes validated successfully.\n');
      process.exit(0);
    } else {
      for (const err of result.errors) {
        process.stderr.write(`VALIDATION ERROR: ${err}\n`);
      }
      process.exit(1);
    }
  }

  // --help / --list / no query type
  if (help || list || queryType === undefined) {
    process.stderr.write(HELP_TEXT);
    if (queryType === undefined && !help && !list) {
      process.exit(1);
    }
    process.exit(0);
  }

  // Check standard routes
  const standardRoute = ROUTES.get(queryType);
  if (standardRoute) {
    const args = [...positionalArgs, ...standardRoute.flags, ...extraFlags];
    runTool(standardRoute.tool, args);
    return;
  }

  // Check arg-rewriting routes
  if (ARG_REWRITE_QUERY_TYPES.has(queryType)) {
    if (queryType === 'consumers') {
      // ast-query consumers src/file.ts -> ast-imports --consumers src/file.ts
      const file = positionalArgs[0];
      if (!file) {
        process.stderr.write('Error: consumers requires a file path argument.\n');
        process.exit(1);
      }
      const args = ['--consumers', file, ...extraFlags];
      runTool('ast-imports', args);
      return;
    }

    if (queryType === 'symbol') {
      // ast-query symbol MyComponent src/ -> ast-imports src/ --symbol MyComponent
      const symbolName = positionalArgs[0];
      const paths = positionalArgs.slice(1);
      if (!symbolName) {
        process.stderr.write('Error: symbol requires a symbol name argument.\n');
        process.exit(1);
      }
      const args = [...paths, '--symbol', symbolName, ...extraFlags];
      runTool('ast-imports', args);
      return;
    }
  }

  // Check known unroutable tools
  const unroutable = KNOWN_UNROUTABLE.get(queryType);
  if (unroutable) {
    process.stderr.write(`"${queryType}" cannot be dispatched through ast-query (non-standard CLI).\n`);
    process.stderr.write(`Run directly: ${unroutable.invocation}\n`);
    process.exit(0);
  }

  // No match -- log gap and show help
  process.stderr.write(`Unknown query type: "${queryType}"\n\n`);
  process.stderr.write(HELP_TEXT);
  appendGap(queryType, gapsFilePath);
  process.stderr.write(`Appended to GAPS.md. Use sg or rg as fallback.\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { ROUTES, KNOWN_UNROUTABLE, ARG_REWRITE_QUERY_TYPES, validateRoutes, HELP_TEXT, SCRIPTS_AST_DIR };

// ---------------------------------------------------------------------------
// Direct run guard
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url).includes(process.argv[1]);
if (isDirectRun) {
  main();
}
