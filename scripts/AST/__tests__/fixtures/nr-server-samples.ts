/* eslint-disable @typescript-eslint/no-unused-vars, no-console */

// Fixture for ast-nr-server: NR server APM integration patterns

// 1. NR APM import
import newrelic from 'newrelic';

// 2. noticeError call
function handleError(err: Error) {
  newrelic.noticeError(err, { requestId: '123' });
}

// 3. addCustomAttributes call
function setUserContext(userId: string, orgId: number) {
  newrelic.addCustomAttributes({ userId, organizationId: orgId });
}

// 4. Custom segment
async function queryWithSegment() {
  return newrelic.startSegment('clickhouse-query', true, async () => {
    return clickhouse.query({ query: 'SELECT 1' });
  });
}

// 5. Missing error report: catch with console.error but no NR
function missingNrReport() {
  try {
    doSomething();
  } catch (err) {
    console.error('Error:', err);
  }
}

// 6. Catch WITH NR noticeError (should NOT trigger NR_MISSING_ERROR_REPORT)
function withNrReport() {
  try {
    doSomething();
  } catch (err) {
    newrelic.noticeError(err as Error);
  }
}

// Declarations
declare function doSomething(): void;
declare const clickhouse: { query(opts: { query: string }): Promise<unknown> };
