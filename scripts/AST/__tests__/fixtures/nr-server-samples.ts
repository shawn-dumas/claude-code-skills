/* eslint-disable @typescript-eslint/no-unused-vars, no-console */

// Fixture for ast-nr-server: OTel server observability patterns (NR via OTLP)

// 1. OTel tracer import
import { withSpan, recordError, setSpanAttributes } from '@/server/lib/otelTracer';
import { withChSegment } from '@/server/lib/withChSegment';

// 2. recordError call
function handleError(err: Error) {
  recordError(err, { requestId: '123' });
}

// 3. setSpanAttributes call
function setUserContext(userId: string, orgId: number) {
  setSpanAttributes({ userId, organizationId: orgId });
}

// 4. withSpan call (manual span)
async function queryWithSpan() {
  return withSpan('DB:fetchUser', async () => {
    return db.query('SELECT * FROM users');
  });
}

// 5. withChSegment call (ClickHouse span)
async function queryWithChSegment() {
  return withChSegment('getTeamActivity' as QueryName, async () => {
    return clickhouse.query({ query: 'SELECT 1' });
  });
}

// 6. Missing error report: catch with console.error but no recordError
function missingOtelReport() {
  try {
    doSomething();
  } catch (err) {
    console.error('Error:', err);
  }
}

// 7. Catch WITH recordError (should NOT trigger NR_MISSING_ERROR_REPORT)
function withOtelReport() {
  try {
    doSomething();
  } catch (err) {
    console.error('Error:', err);
    recordError(err);
  }
}

// Declarations
declare function doSomething(): void;
declare const clickhouse: { query(opts: { query: string }): Promise<unknown> };
declare const db: { query(sql: string): Promise<unknown> };
type QueryName = string;
