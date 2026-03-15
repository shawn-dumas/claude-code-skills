import fs from 'fs';

interface Report {
  title: string;
  rows: number[][];
}

export function processReport(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const report: Report = JSON.parse(raw);

  const totals = report.rows.map(row => row.reduce((sum, n) => sum + n, 0));

  const avg = totals.length > 0 ? totals.reduce((s, n) => s + n, 0) / totals.length : 0;

  const output = `${report.title}: avg=${avg.toFixed(2)}`;
  fs.writeFileSync(filePath + '.summary', output);
  return output;
}
