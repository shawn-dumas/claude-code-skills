/* eslint-disable */
/**
 * Fixture: vi.spyOn usage for SPY_DECLARATION observation.
 *
 * Covers line 1072 in ast-test-analysis.ts where SPY_DECLARATION observations
 * are pushed when a vi.spyOn() call is detected with 2+ arguments.
 */
import { describe, it, expect, vi } from 'vitest';

const console_ = console;
const window_ = window;

describe('spy declaration fixture', () => {
  it('spies on console.warn', () => {
    const warnSpy = vi.spyOn(console_, 'warn');
    warnSpy.mockImplementation(() => undefined);
    expect(warnSpy).toBeDefined();
  });

  it('spies on window.fetch', () => {
    const fetchSpy = vi.spyOn(window_, 'fetch');
    expect(fetchSpy).toBeDefined();
  });
});
