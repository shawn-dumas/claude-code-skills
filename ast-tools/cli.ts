interface CliArgs {
  paths: string[];
  pretty: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  return {
    paths: args.filter(a => !a.startsWith('--')),
    pretty: args.includes('--pretty'),
    help: args.includes('--help'),
  };
}

export function output(data: unknown, pretty: boolean): void {
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  process.stdout.write(json + '\n');
}

export function fatal(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
