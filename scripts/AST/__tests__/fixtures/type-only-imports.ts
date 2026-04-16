import type { ExportInfo, ImportInfo } from '../../types';

export function formatExport(info: ExportInfo): string {
  return `${info.name}: ${info.kind}`;
}

export function formatImport(info: ImportInfo): string {
  return `${info.source} [${info.specifiers.join(', ')}]`;
}
