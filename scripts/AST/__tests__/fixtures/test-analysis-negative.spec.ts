/**
 * Negative fixture for ast-test-analysis observation extraction.
 *
 * This file contains edge cases and ambiguous patterns that exercise
 * observation extraction boundaries. The observations report raw facts;
 * the interpreter (prompt 16) will classify them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// 1. vi.mock of a module that looks like a hook but isn't a hook
// The file 'usefulness.ts' is a utility with function named starting with 'use'
// MOCK_DECLARATION observation: target = '../utils/usefulness'
// The interpreter checks resolved exports to classify, not just the name.
vi.mock('../utils/usefulness');

// 2. vi.mock of a package that is not in BOUNDARY_PACKAGES
// MOCK_DECLARATION: target = 'lodash'
// The interpreter classifies as THIRD_PARTY, not BOUNDARY
vi.mock('lodash');

// 3. afterEach with custom cleanup (not a standard restore pattern)
// AFTER_EACH_BLOCK present, but no CLEANUP_CALL for standard patterns
afterEach(() => {
  customCleanupFunction();
});

// 4. Import from test helpers that re-exports from fixtures
// This is TEST_HELPER_IMPORT, not directly FIXTURE_IMPORT
// The interpreter can trace the re-export chain if needed.
// @ts-expect-error -- fixture file, module doesn't exist
import { buildUser } from '../test-helpers';

describe('edge cases', () => {
  it('assertion using screen but with a non-query method', () => {
    // screen.debug() is not a testing-library query
    // ASSERTION_CALL with isScreenQuery: true, but matcherName is 'toBeUndefined'
    // Not clearly USER_VISIBLE or IMPLEMENTATION_DETAIL from observation alone
    expect(screen.debug()).toBeUndefined();
  });

  it('assertion on internal state accessor', () => {
    // This is clearly IMPLEMENTATION_DETAIL by the interpreter
    // ASSERTION_CALL observation records the raw expect arg
    const component = { internalState: 5 };
    expect(component.internalState).toBe(5);
  });

  it('callback assertion on non-prop function', () => {
    // Not a prop callback, but uses toHaveBeenCalled
    // ASSERTION_CALL observation records the matcher and arg
    // Interpreter must decide if this is CALLBACK_FIRED or IMPLEMENTATION_DETAIL
    const internalSpy = vi.fn();
    internalSpy();
    expect(internalSpy).toHaveBeenCalled();
  });

  it('uses fixture data indirectly', () => {
    // buildUser comes from test-helpers which re-exports from fixtures
    // Observation layer sees TEST_HELPER_IMPORT, not FIXTURE_IMPORT
    const user = buildUser();
    expect(user.name).toBeDefined();
  });
});

// Declarations to make the file parse (never executed)
declare const screen: { debug: () => void };
declare function customCleanupFunction(): void;
