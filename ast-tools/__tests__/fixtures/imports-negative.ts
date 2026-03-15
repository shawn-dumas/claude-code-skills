/* eslint-disable */
// Negative fixture: no imports, no exports.
// Should produce zero import/export observations.

type InternalConfig = {
  retryCount: number;
  timeout: number;
};

const DEFAULT_CONFIG: InternalConfig = {
  retryCount: 3,
  timeout: 5000,
};

function computeDelay(attempt: number): number {
  return DEFAULT_CONFIG.timeout * Math.pow(2, attempt);
}
