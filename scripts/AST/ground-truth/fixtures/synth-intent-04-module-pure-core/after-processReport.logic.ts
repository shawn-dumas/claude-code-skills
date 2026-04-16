export function computeReportSummary(title: string, rows: number[][]): string {
  const totals = rows.map(row => row.reduce((sum, n) => sum + n, 0));

  const avg = totals.length > 0 ? totals.reduce((s, n) => s + n, 0) / totals.length : 0;

  return `${title}: avg=${avg.toFixed(2)}`;
}
