import fg from 'fast-glob';

export interface CliArgs {
  paths: string[];
  pretty: boolean;
  help: boolean;
  /** Named options from --key value pairs (e.g., --source-branch production). */
  options: Record<string, string>;
  /** Boolean flags that were present (without leading --), e.g. 'no-cache', 'test-files', 'count'. */
  flags: Set<string>;
}

export interface ParseArgsOptions {
  namedOptions?: readonly string[];
  extraBooleanFlags?: readonly string[];
}

const DEFAULT_NAMED_OPTIONS = ['--kind', '--source-branch'] as const;
const DEFAULT_BOOLEAN_FLAGS = ['--pretty', '--help', '--no-cache', '--test-files', '--count'] as const;

/**
 * Parse CLI arguments into paths, flags, and named options.
 *
 * Positional args (no leading --) go into `paths`.
 * Boolean flags (--pretty, --help, --no-cache, --test-files, --count,
 * plus any extraBooleanFlags) set their field.
 * Named options (--key value) go into `options` as key-value pairs.
 * --kind is a default named option; additional named options can be
 * supplied via `options.namedOptions`.
 *
 * Unknown --flags are silently dropped. A typo like --source-branchh
 * will drop the flag and its value goes into paths. Use --help output
 * to verify flag names.
 *
 * After collecting paths, any path containing glob characters (*, ?, {)
 * is expanded using fast-glob.
 */
export function parseArgs(argv: string[], options: ParseArgsOptions | readonly string[] = {}): CliArgs {
  // Backward compat: second arg used to be just namedOptions array
  let namedOptions: readonly string[] = [];
  let extraBooleanFlags: readonly string[] = [];

  if (Array.isArray(options)) {
    namedOptions = options;
  } else {
    namedOptions = (options as ParseArgsOptions).namedOptions ?? [];
    extraBooleanFlags = (options as ParseArgsOptions).extraBooleanFlags ?? [];
  }

  const args = argv.slice(2);
  const namedSet = new Set([...DEFAULT_NAMED_OPTIONS, ...namedOptions]);
  const booleanFlagSet = new Set([
    ...DEFAULT_BOOLEAN_FLAGS,
    ...extraBooleanFlags.map(f => (f.startsWith('--') ? f : `--${f}`)),
  ]);

  const paths: string[] = [];
  const optionsMap: Record<string, string> = {};
  const flags = new Set<string>();
  const consumedIndices = new Set<number>();

  for (let i = 0; i < args.length; i++) {
    if (consumedIndices.has(i)) continue;
    const arg = args[i];

    if (namedSet.has(arg) && i + 1 < args.length) {
      // Strip leading -- for the key
      optionsMap[arg.replace(/^--/, '')] = args[i + 1];
      consumedIndices.add(i);
      consumedIndices.add(i + 1);
      i++; // skip value
    } else if (booleanFlagSet.has(arg)) {
      flags.add(arg.replace(/^--/, ''));
    } else if (!arg.startsWith('--')) {
      paths.push(arg);
    }
  }

  // Expand globs in paths
  const expandedPaths: string[] = [];
  for (const p of paths) {
    if (/[*?{]/.test(p)) {
      expandedPaths.push(...fg.sync(p, { absolute: false }));
    } else {
      expandedPaths.push(p);
    }
  }

  return {
    paths: expandedPaths,
    pretty: flags.has('pretty'),
    help: flags.has('help'),
    options: optionsMap,
    flags,
  };
}

export function output(data: unknown, pretty: boolean): void {
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  process.stdout.write(json + '\n');
}

/**
 * Known property names that contain observation-like arrays with `kind` fields.
 * Used by --kind filtering and --count mode to locate observation arrays
 * regardless of the property name each tool uses.
 */
const OBSERVATION_PROPERTIES = ['observations', 'hookObservations', 'componentObservations'];

/**
 * Collect all observation-like arrays from a result object.
 * Returns entries as [propertyName, array] pairs.
 */
function collectObservationArrays(obj: Record<string, unknown>): [string, Record<string, unknown>[]][] {
  const result: [string, Record<string, unknown>[]][] = [];
  for (const prop of OBSERVATION_PROPERTIES) {
    if (Array.isArray(obj[prop])) {
      result.push([prop, obj[prop] as Record<string, unknown>[]]);
    }
  }
  return result;
}

/**
 * Output with optional --kind filtering and --count mode.
 *
 * --kind <KIND>: filter observation arrays to only include matching kinds.
 * --count: output observation kind counts instead of full data.
 *
 * Searches known observation property names (observations, hookObservations,
 * componentObservations) so filtering works across all tool output shapes.
 */
export function outputFiltered(data: unknown, pretty: boolean, opts: { kind?: string; count?: boolean }): void {
  let result = data;

  // Apply --kind filtering across all observation arrays in result items
  if (opts.kind) {
    const filterItem = (item: Record<string, unknown>): Record<string, unknown> => {
      const patched = { ...item };
      for (const [prop, arr] of collectObservationArrays(item)) {
        patched[prop] = arr.filter(o => o.kind === opts.kind);
      }
      return patched;
    };

    if (Array.isArray(result)) {
      result = result.map((item: Record<string, unknown>) => filterItem(item));
    } else if (typeof result === 'object' && result !== null) {
      result = filterItem(result as Record<string, unknown>);
    }
  }

  // Count mode: output observation kind counts instead of full data
  if (opts.count) {
    const counts: Record<string, number> = {};
    const items = Array.isArray(result) ? result : [result];
    for (const item of items) {
      const obj = item as Record<string, unknown>;
      for (const [, arr] of collectObservationArrays(obj)) {
        for (const o of arr) {
          const kind = o.kind as string;
          counts[kind] = (counts[kind] ?? 0) + 1;
        }
      }
    }
    output(counts, pretty);
    return;
  }

  output(result, pretty);
}

export function fatal(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
