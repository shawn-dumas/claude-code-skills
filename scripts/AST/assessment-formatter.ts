/**
 * Shared pretty-print formatter for AST interpreter assessment tables.
 *
 * Extracts the duplicated formatPrettyOutput() pattern found across 7+
 * interpreter tools into a single, fully-tested function. Each interpreter
 * provides a config object (title, columns, optional rationale); this module
 * handles header generation, separator generation, row formatting, and
 * rationale sections.
 *
 * For non-table formatters (pw-parity, vitest-parity, skill-quality),
 * use their own formatters -- this targets the assessment table pattern only.
 */

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export type Align = 'left' | 'right';

export interface ColumnDef<A> {
  /** Column header text. */
  header: string;
  /** Minimum display width for data values. Effective width = max(width, header.length). */
  width: number;
  /** Alignment: 'left' (padEnd, default) or 'right' (padStart). */
  align?: Align;
  /** Extract the display string from an assessment. Truncation/formatting is the caller's job. */
  extract: (a: A) => string;
}

export interface AssessmentTableConfig<A> {
  /** Title line (first line of output). */
  title: string;
  /** Message shown when assessments array is empty. */
  emptyMessage: string;
  /** Column definitions. Order determines display order. */
  columns: readonly ColumnDef<A>[];
  /** Optional rationale section appended after the table. */
  rationale?: (a: A) => string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function effectiveWidth<A>(col: ColumnDef<A>): number {
  return Math.max(col.width, col.header.length);
}

function padCell(value: string, width: number, align: Align): string {
  const truncated = value.slice(0, width);
  return align === 'right' ? truncated.padStart(width) : truncated.padEnd(width);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format an assessment table as a human-readable string.
 *
 * Produces: title, blank line, header, separator, data rows,
 * and optionally a rationale section.
 */
export function formatAssessmentTable<A>(config: AssessmentTableConfig<A>, assessments: readonly A[]): string {
  const lines: string[] = [];
  lines.push(config.title);
  lines.push('');

  if (assessments.length === 0) {
    lines.push(config.emptyMessage);
    return lines.join('\n');
  }

  const widths = config.columns.map(effectiveWidth);
  const aligns = config.columns.map(c => c.align ?? 'left');

  // Header
  const headerCells = config.columns.map((col, i) => padCell(col.header, widths[i], aligns[i]));
  const headerLine = headerCells.join(' | ');
  lines.push(headerLine);

  // Separator: replace every non-pipe char with '-', pipe with '+'
  const separator = headerLine.replace(/[^|]/g, '-').replace(/\|/g, '+');
  lines.push(separator);

  // Data rows
  for (const a of assessments) {
    const cells = config.columns.map((col, i) => padCell(col.extract(a), widths[i], aligns[i]));
    lines.push(cells.join(' | '));
  }

  // Rationale section
  if (config.rationale) {
    lines.push('');
    lines.push('Rationale:');
    for (const a of assessments) {
      lines.push(config.rationale(a));
    }
  }

  return lines.join('\n');
}
