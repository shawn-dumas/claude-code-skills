/* eslint-disable */
/**
 * Fixture: SEQUENTIAL_MOCK_RESPONSE with an interrupted sequence.
 *
 * Covers line 1386 in ast-test-analysis.ts: the branch that fires when
 * 3+ consecutive mockResponseOnce calls are followed by a non-sequential
 * statement (as opposed to the trailing-sequence path on line 1398, which
 * fires when consecutive calls appear at the end of the function body).
 */
import { describe, it, expect } from 'vitest';

declare const fetchMock: {
  mockResponseOnce: (body: string) => void;
  resetMocks: () => void;
};

// 3 sequential mockResponseOnce calls followed by a non-sequential statement.
// The "else" branch (line 1386) fires when consecutiveCount >= 3 and the
// current statement is NOT a mockResponseOnce call.
function setupInterruptedSequence() {
  fetchMock.mockResponseOnce(JSON.stringify({ a: 1 }));
  fetchMock.mockResponseOnce(JSON.stringify({ b: 2 }));
  fetchMock.mockResponseOnce(JSON.stringify({ c: 3 }));
  // Non-sequential statement interrupts the run -- triggers line 1386
  fetchMock.resetMocks();
}

describe('interrupted mock ordering', () => {
  it('uses interrupted sequential mocks', () => {
    setupInterruptedSequence();
    expect(true).toBe(true);
  });
});
