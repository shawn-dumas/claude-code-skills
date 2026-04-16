import fs from 'fs';
import { computeReportSummary } from './processReport.logic';

interface Report {
  title: string;
  rows: number[][];
}

export function processReport(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const report: Report = JSON.parse(raw);
  const output = computeReportSummary(report.title, report.rows);
  fs.writeFileSync(filePath + '.summary', output);
  return output;
}
