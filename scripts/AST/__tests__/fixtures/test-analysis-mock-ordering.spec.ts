/* eslint-disable */
/**
 * Fixture for SEQUENTIAL_MOCK_RESPONSE observation.
 *
 * Contains both positive (fragile sequential ordering) and negative
 * (URL-based routing) patterns to verify detection accuracy.
 */
import { describe, it, expect, beforeEach } from 'vitest';

declare const fetchMock: {
  mockResponseOnce: (body: string | (() => Promise<string>), init?: object) => void;
  mockResponse: (handler: (req: { url: string }) => Promise<{ body: string }>) => void;
  resetMocks: () => void;
};

// --- POSITIVE: 3 sequential mockResponseOnce calls (should be flagged) ---
function setupThreeSequential() {
  fetchMock.mockResponseOnce(JSON.stringify({ hosts: [] }));
  fetchMock.mockResponseOnce(JSON.stringify({ latency: [] }));
  fetchMock.mockResponseOnce(JSON.stringify({ urls: [] }));
}

// --- POSITIVE: 7 sequential mockResponseOnce calls (should be flagged) ---
function setupSevenSequential() {
  fetchMock.mockResponseOnce(JSON.stringify({ overview: [] }));
  fetchMock.mockResponseOnce(JSON.stringify({ pages: [] }));
  fetchMock.mockResponseOnce(JSON.stringify({ activitiesInto: [] }));
  fetchMock.mockResponseOnce(JSON.stringify({ activitiesOutOf: [] }));
  fetchMock.mockResponseOnce(JSON.stringify({ activitiesWithin: [] }));
  fetchMock.mockResponseOnce(JSON.stringify({ byUser: [] }));
  fetchMock.mockResponseOnce(JSON.stringify({ occurrences: [] }));
}

// --- NEGATIVE: only 2 sequential (below threshold, should NOT be flagged) ---
function setupTwoSequential() {
  fetchMock.mockResponseOnce(JSON.stringify({ a: 1 }));
  fetchMock.mockResponseOnce(JSON.stringify({ b: 2 }));
}

// --- NEGATIVE: URL-based routing (should NOT be flagged) ---
function setupUrlRouting() {
  fetchMock.mockResponse(req => {
    const url = req.url;
    if (url.includes('/hosts')) {
      return Promise.resolve({ body: JSON.stringify({ hosts: [] }) });
    }
    if (url.includes('/latency')) {
      return Promise.resolve({ body: JSON.stringify({ latency: [] }) });
    }
    return Promise.resolve({ body: '{}' });
  });
}

describe('mock ordering fixture', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it('uses three sequential mocks', () => {
    setupThreeSequential();
    expect(true).toBe(true);
  });

  it('uses seven sequential mocks', () => {
    setupSevenSequential();
    expect(true).toBe(true);
  });

  it('uses two sequential mocks (ok)', () => {
    setupTwoSequential();
    expect(true).toBe(true);
  });

  it('uses URL routing (ok)', () => {
    setupUrlRouting();
    expect(true).toBe(true);
  });
});
