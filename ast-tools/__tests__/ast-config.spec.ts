import { describe, it, expect } from 'vitest';
import { astConfig, PRIORITY_RULES, lookupPriority } from '../ast-config';

describe('ast-config', () => {
  describe('config structure', () => {
    it('has all required top-level sections', () => {
      const sections = [
        'react',
        'hooks',
        'effects',
        'sideEffects',
        'storage',
        'env',
        'featureFlags',
        'dataLayer',
        'typeSafety',
        'testing',
        'jsx',
        'complexity',
        'fileDiscovery',
        'imports',
        'truncation',
      ];

      for (const section of sections) {
        expect(astConfig).toHaveProperty(section);
      }
    });
  });

  describe('react section', () => {
    it('builtinHooks is non-empty', () => {
      expect(astConfig.react.builtinHooks.size).toBeGreaterThan(0);
    });

    it('builtinHooks contains expected core hooks', () => {
      expect(astConfig.react.builtinHooks.has('useState')).toBe(true);
      expect(astConfig.react.builtinHooks.has('useEffect')).toBe(true);
      expect(astConfig.react.builtinHooks.has('useMemo')).toBe(true);
      expect(astConfig.react.builtinHooks.has('useCallback')).toBe(true);
      expect(astConfig.react.builtinHooks.has('useRef')).toBe(true);
    });

    it('hookOptionProperties is non-empty', () => {
      expect(astConfig.react.hookOptionProperties.size).toBeGreaterThan(0);
    });

    it('hookOptionProperties contains TanStack Query options', () => {
      expect(astConfig.react.hookOptionProperties.has('queryFn')).toBe(true);
      expect(astConfig.react.hookOptionProperties.has('onSuccess')).toBe(true);
      expect(astConfig.react.hookOptionProperties.has('onError')).toBe(true);
    });

    it('jsxReturnTypeMarkers is non-empty', () => {
      expect(astConfig.react.jsxReturnTypeMarkers.length).toBeGreaterThan(0);
    });

    it('jsxReturnTypeMarkers contains JSX', () => {
      expect(astConfig.react.jsxReturnTypeMarkers).toContain('JSX');
    });

    it('wrapperHocMap has memo and forwardRef entries', () => {
      expect(astConfig.react.wrapperHocMap.memo).toBe('memo');
      expect(astConfig.react.wrapperHocMap.forwardRef).toBe('forwardRef');
      expect(astConfig.react.wrapperHocMap['React.memo']).toBe('memo');
      expect(astConfig.react.wrapperHocMap['React.forwardRef']).toBe('forwardRef');
    });
  });

  describe('hooks section', () => {
    it('ambientLeafHooks is non-empty', () => {
      expect(astConfig.hooks.ambientLeafHooks.size).toBeGreaterThan(0);
    });

    it('ambientLeafHooks contains MAY_REMAIN_HOOKS values', () => {
      expect(astConfig.hooks.ambientLeafHooks.has('useBreakpoints')).toBe(true);
      expect(astConfig.hooks.ambientLeafHooks.has('usePagination')).toBe(true);
      expect(astConfig.hooks.ambientLeafHooks.has('useSorting')).toBe(true);
      expect(astConfig.hooks.ambientLeafHooks.has('useTheme')).toBe(true);
    });

    it('knownContextHooks is non-empty', () => {
      expect(astConfig.hooks.knownContextHooks.size).toBeGreaterThan(0);
    });

    it('knownContextHooks contains KNOWN_CONTEXT_HOOKS values', () => {
      expect(astConfig.hooks.knownContextHooks.has('useAuthState')).toBe(true);
      expect(astConfig.hooks.knownContextHooks.has('usePosthogContext')).toBe(true);
      expect(astConfig.hooks.knownContextHooks.has('useTeams')).toBe(true);
    });

    it('tanstackQueryHooks is non-empty', () => {
      expect(astConfig.hooks.tanstackQueryHooks.size).toBeGreaterThan(0);
    });

    it('tanstackQueryHooks contains core TanStack hooks', () => {
      expect(astConfig.hooks.tanstackQueryHooks.has('useQuery')).toBe(true);
      expect(astConfig.hooks.tanstackQueryHooks.has('useMutation')).toBe(true);
      expect(astConfig.hooks.tanstackQueryHooks.has('useInfiniteQuery')).toBe(true);
    });

    it('path patterns are non-empty strings', () => {
      expect(astConfig.hooks.serviceHookPathPatterns.length).toBeGreaterThan(0);
      expect(astConfig.hooks.contextHookPathPatterns.length).toBeGreaterThan(0);
      expect(astConfig.hooks.domUtilityPathPatterns.length).toBeGreaterThan(0);

      for (const pattern of astConfig.hooks.serviceHookPathPatterns) {
        expect(pattern).toBeTruthy();
      }
      for (const pattern of astConfig.hooks.contextHookPathPatterns) {
        expect(pattern).toBeTruthy();
      }
      for (const pattern of astConfig.hooks.domUtilityPathPatterns) {
        expect(pattern).toBeTruthy();
      }
    });

    it('scopeHookSuffix is a non-empty string', () => {
      expect(astConfig.hooks.scopeHookSuffix).toBe('Scope');
    });
  });

  describe('effects section', () => {
    it('effectHookNames is non-empty', () => {
      expect(astConfig.effects.effectHookNames.size).toBeGreaterThan(0);
    });

    it('effectHookNames contains useEffect and useLayoutEffect', () => {
      expect(astConfig.effects.effectHookNames.has('useEffect')).toBe(true);
      expect(astConfig.effects.effectHookNames.has('useLayoutEffect')).toBe(true);
    });

    it('fetchFunctions is non-empty', () => {
      expect(astConfig.effects.fetchFunctions.size).toBeGreaterThan(0);
    });

    it('timerFunctions is non-empty', () => {
      expect(astConfig.effects.timerFunctions.size).toBeGreaterThan(0);
    });

    it('storageIdentifiers is non-empty', () => {
      expect(astConfig.effects.storageIdentifiers.size).toBeGreaterThan(0);
    });
  });

  describe('sideEffects section', () => {
    it('consoleMethods is non-empty', () => {
      expect(astConfig.sideEffects.consoleMethods.size).toBeGreaterThan(0);
    });

    it('consoleMethods contains standard console methods', () => {
      expect(astConfig.sideEffects.consoleMethods.has('log')).toBe(true);
      expect(astConfig.sideEffects.consoleMethods.has('error')).toBe(true);
      expect(astConfig.sideEffects.consoleMethods.has('warn')).toBe(true);
    });

    it('timerFunctions includes cancel/clear variants', () => {
      expect(astConfig.sideEffects.timerFunctions.has('setTimeout')).toBe(true);
      expect(astConfig.sideEffects.timerFunctions.has('clearTimeout')).toBe(true);
      expect(astConfig.sideEffects.timerFunctions.has('setInterval')).toBe(true);
      expect(astConfig.sideEffects.timerFunctions.has('clearInterval')).toBe(true);
    });

    it('posthogDirectCalls is non-empty', () => {
      expect(astConfig.sideEffects.posthogDirectCalls.size).toBeGreaterThan(0);
    });

    it('posthogMethodCalls is non-empty', () => {
      expect(astConfig.sideEffects.posthogMethodCalls.size).toBeGreaterThan(0);
    });

    it('windowMutationCalls is non-empty', () => {
      expect(astConfig.sideEffects.windowMutationCalls.size).toBeGreaterThan(0);
    });
  });

  describe('storage section', () => {
    it('directStorageMethods is non-empty', () => {
      expect(astConfig.storage.directStorageMethods.size).toBeGreaterThan(0);
    });

    it('directStorageMethods contains standard storage methods', () => {
      expect(astConfig.storage.directStorageMethods.has('getItem')).toBe(true);
      expect(astConfig.storage.directStorageMethods.has('setItem')).toBe(true);
      expect(astConfig.storage.directStorageMethods.has('removeItem')).toBe(true);
      expect(astConfig.storage.directStorageMethods.has('clear')).toBe(true);
    });

    it('typedStorageHelpers has correct mappings', () => {
      expect(astConfig.storage.typedStorageHelpers.readStorage).toBe('TYPED_STORAGE_READ');
      expect(astConfig.storage.typedStorageHelpers.writeStorage).toBe('TYPED_STORAGE_WRITE');
      expect(astConfig.storage.typedStorageHelpers.removeStorage).toBe('TYPED_STORAGE_REMOVE');
    });

    it('cookieMethods is non-empty', () => {
      expect(astConfig.storage.cookieMethods.size).toBeGreaterThan(0);
    });

    it('directStorageTypeMap has correct mappings', () => {
      expect(astConfig.storage.directStorageTypeMap.localStorage).toBe('DIRECT_LOCAL_STORAGE');
      expect(astConfig.storage.directStorageTypeMap.sessionStorage).toBe('DIRECT_SESSION_STORAGE');
    });
  });

  describe('env section', () => {
    it('wrapperIdentifiers has correct mappings', () => {
      expect(astConfig.env.wrapperIdentifiers.clientEnv).toBe('CLIENT_ENV_ACCESS');
      expect(astConfig.env.wrapperIdentifiers.serverEnv).toBe('SERVER_ENV_ACCESS');
    });

    it('clientEnvPathPatterns is non-empty', () => {
      expect(astConfig.env.clientEnvPathPatterns.length).toBeGreaterThan(0);
    });

    it('serverEnvPathPatterns is non-empty', () => {
      expect(astConfig.env.serverEnvPathPatterns.length).toBeGreaterThan(0);
    });

    it('treeShakingCommentMarkers is non-empty', () => {
      expect(astConfig.env.treeShakingCommentMarkers.length).toBeGreaterThan(0);
    });
  });

  describe('featureFlags section', () => {
    it('flagHooks is non-empty', () => {
      expect(astConfig.featureFlags.flagHooks.size).toBeGreaterThan(0);
    });

    it('flagHooks contains expected hooks', () => {
      expect(astConfig.featureFlags.flagHooks.has('usePosthogContext')).toBe(true);
      expect(astConfig.featureFlags.flagHooks.has('useFeatureFlags')).toBe(true);
    });

    it('pageGuardHook is correct', () => {
      expect(astConfig.featureFlags.pageGuardHook).toBe('useFeatureFlagPageGuard');
    });

    it('flagBindingName is correct', () => {
      expect(astConfig.featureFlags.flagBindingName).toBe('featureFlags');
    });

    it('overrideFunctions is non-empty', () => {
      expect(astConfig.featureFlags.overrideFunctions.size).toBeGreaterThan(0);
    });

    it('tabGateProperty is correct', () => {
      expect(astConfig.featureFlags.tabGateProperty).toBe('featureFlag');
    });
  });

  describe('dataLayer section', () => {
    it('queryHookSuffix is correct', () => {
      expect(astConfig.dataLayer.queryHookSuffix).toBe('Query');
    });

    it('mutationHookSuffix is correct', () => {
      expect(astConfig.dataLayer.mutationHookSuffix).toBe('Mutation');
    });

    it('queryKeyFactorySuffix is correct', () => {
      expect(astConfig.dataLayer.queryKeyFactorySuffix).toBe('Keys');
    });

    it('fetchApiIdentifiers is non-empty', () => {
      expect(astConfig.dataLayer.fetchApiIdentifiers.size).toBeGreaterThan(0);
    });

    it('fetchApiIdentifiers contains expected values', () => {
      expect(astConfig.dataLayer.fetchApiIdentifiers.has('fetchApi')).toBe(true);
      expect(astConfig.dataLayer.fetchApiIdentifiers.has('useFetchApi')).toBe(true);
    });

    it('invalidateMethod is correct', () => {
      expect(astConfig.dataLayer.invalidateMethod).toBe('invalidateQueries');
    });

    it('apiPathMarker is correct', () => {
      expect(astConfig.dataLayer.apiPathMarker).toBe('/api/');
    });
  });

  describe('typeSafety section', () => {
    it('trustBoundaryCalls is non-empty', () => {
      expect(astConfig.typeSafety.trustBoundaryCalls.size).toBeGreaterThan(0);
    });

    it('trustBoundaryCalls contains expected calls', () => {
      expect(astConfig.typeSafety.trustBoundaryCalls.has('JSON.parse')).toBe(true);
      expect(astConfig.typeSafety.trustBoundaryCalls.has('readStorage')).toBe(true);
    });

    it('trustBoundaryMethodCalls is non-empty', () => {
      expect(astConfig.typeSafety.trustBoundaryMethodCalls.size).toBeGreaterThan(0);
    });

    it('trustBoundaryPropertyAccess is non-empty', () => {
      expect(astConfig.typeSafety.trustBoundaryPropertyAccess.size).toBeGreaterThan(0);
    });

    it('guardLookbackDistance is a positive number', () => {
      expect(astConfig.typeSafety.guardLookbackDistance).toBeGreaterThan(0);
    });
  });

  describe('testing section', () => {
    it('boundaryPackages is non-empty', () => {
      expect(astConfig.testing.boundaryPackages.size).toBeGreaterThan(0);
    });

    it('boundaryPackages contains expected packages', () => {
      expect(astConfig.testing.boundaryPackages.has('next/router')).toBe(true);
      expect(astConfig.testing.boundaryPackages.has('firebase')).toBe(true);
      expect(astConfig.testing.boundaryPackages.has('posthog-js')).toBe(true);
    });

    it('boundaryGlobals is non-empty', () => {
      expect(astConfig.testing.boundaryGlobals.size).toBeGreaterThan(0);
    });

    it('boundaryGlobals contains expected globals', () => {
      expect(astConfig.testing.boundaryGlobals.has('window')).toBe(true);
      expect(astConfig.testing.boundaryGlobals.has('document')).toBe(true);
      expect(astConfig.testing.boundaryGlobals.has('localStorage')).toBe(true);
    });

    it('boundaryFunctionNames is non-empty', () => {
      expect(astConfig.testing.boundaryFunctionNames.size).toBeGreaterThan(0);
    });

    it('testingLibraryQueries is non-empty', () => {
      expect(astConfig.testing.testingLibraryQueries.size).toBeGreaterThan(0);
    });

    it('testingLibraryQueries has 34 entries', () => {
      expect(astConfig.testing.testingLibraryQueries.size).toBe(34);
    });

    it('userVisibleMatchers is non-empty', () => {
      expect(astConfig.testing.userVisibleMatchers.size).toBeGreaterThan(0);
    });

    it('userVisibleMatchers has 8 entries', () => {
      expect(astConfig.testing.userVisibleMatchers.size).toBe(8);
    });

    it('snapshotMatchers is non-empty', () => {
      expect(astConfig.testing.snapshotMatchers.size).toBeGreaterThan(0);
    });

    it('calledMatchers is non-empty', () => {
      expect(astConfig.testing.calledMatchers.size).toBeGreaterThan(0);
    });

    it('playwrightSources is non-empty', () => {
      expect(astConfig.testing.playwrightSources.size).toBeGreaterThan(0);
    });

    it('nonPureTestNames is non-empty', () => {
      expect(astConfig.testing.nonPureTestNames.size).toBeGreaterThan(0);
    });

    it('mockRestorePatterns is non-empty', () => {
      expect(astConfig.testing.mockRestorePatterns.length).toBeGreaterThan(0);
    });

    it('storageClearPatterns is non-empty', () => {
      expect(astConfig.testing.storageClearPatterns.length).toBeGreaterThan(0);
    });

    it('testHelperPathPatterns is non-empty', () => {
      expect(astConfig.testing.testHelperPathPatterns.length).toBeGreaterThan(0);
    });

    it('fixtureImportPatterns is non-empty', () => {
      expect(astConfig.testing.fixtureImportPatterns.length).toBeGreaterThan(0);
    });

    it('sharedMutablePatterns is non-empty', () => {
      expect(astConfig.testing.sharedMutablePatterns.length).toBeGreaterThan(0);
    });

    it('providerSignals is non-empty', () => {
      expect(astConfig.testing.providerSignals.length).toBeGreaterThan(0);
    });

    it('domainDirMarkers is non-empty', () => {
      expect(astConfig.testing.domainDirMarkers.length).toBeGreaterThan(0);
    });
  });

  describe('jsx section', () => {
    it('arrayTransformMethods is non-empty', () => {
      expect(astConfig.jsx.arrayTransformMethods.size).toBeGreaterThan(0);
    });

    it('arrayTransformMethods contains expected methods', () => {
      expect(astConfig.jsx.arrayTransformMethods.has('filter')).toBe(true);
      expect(astConfig.jsx.arrayTransformMethods.has('map')).toBe(true);
      expect(astConfig.jsx.arrayTransformMethods.has('reduce')).toBe(true);
    });

    it('thresholds has all required properties', () => {
      expect(astConfig.jsx.thresholds.chainedTernaryDepth).toBeGreaterThan(0);
      expect(astConfig.jsx.thresholds.complexGuardConditions).toBeGreaterThan(0);
      expect(astConfig.jsx.thresholds.inlineTransformChain).toBeGreaterThan(0);
      expect(astConfig.jsx.thresholds.multiStmtHandler).toBeGreaterThan(0);
      expect(astConfig.jsx.thresholds.complexClassNameTernaries).toBeGreaterThan(0);
    });
  });

  describe('complexity section', () => {
    it('complexity section is an empty object', () => {
      expect(Object.keys(astConfig.complexity)).toHaveLength(0);
    });
  });

  describe('fileDiscovery section', () => {
    it('skipDirs is non-empty', () => {
      expect(astConfig.fileDiscovery.skipDirs.size).toBeGreaterThan(0);
    });

    it('skipDirs contains expected directories', () => {
      expect(astConfig.fileDiscovery.skipDirs.has('node_modules')).toBe(true);
      expect(astConfig.fileDiscovery.skipDirs.has('.next')).toBe(true);
      expect(astConfig.fileDiscovery.skipDirs.has('dist')).toBe(true);
    });

    it('excludedTestSuffixes is non-empty', () => {
      expect(astConfig.fileDiscovery.excludedTestSuffixes.length).toBeGreaterThan(0);
    });

    it('moduleResolutionExtensions is non-empty', () => {
      expect(astConfig.fileDiscovery.moduleResolutionExtensions.length).toBeGreaterThan(0);
    });

    it('pathAliasPrefix is correct', () => {
      expect(astConfig.fileDiscovery.pathAliasPrefix).toBe('@/');
    });
  });

  describe('imports section', () => {
    it('nextJsPagePrefix is correct', () => {
      expect(astConfig.imports.nextJsPagePrefix).toBe('src/pages/');
    });
  });

  describe('truncation section', () => {
    it('defaultMaxLength is a positive number', () => {
      expect(astConfig.truncation.defaultMaxLength).toBeGreaterThan(0);
    });

    it('assertionMaxLength is a positive number', () => {
      expect(astConfig.truncation.assertionMaxLength).toBeGreaterThan(0);
    });

    it('mockFactoryMaxLength is a positive number', () => {
      expect(astConfig.truncation.mockFactoryMaxLength).toBeGreaterThan(0);
    });

    it('truncation lengths are in expected order', () => {
      expect(astConfig.truncation.defaultMaxLength).toBeLessThan(astConfig.truncation.assertionMaxLength);
      expect(astConfig.truncation.assertionMaxLength).toBeLessThan(astConfig.truncation.mockFactoryMaxLength);
    });
  });

  describe('no duplicates in Sets', () => {
    it('verifies Sets were constructed correctly (no duplicates)', () => {
      // The Set constructor automatically deduplicates, so if we verify
      // the size matches expected counts, we've confirmed no duplicates
      // were introduced during construction.

      // Spot-check a few Sets with known sizes
      expect(astConfig.react.builtinHooks.size).toBe(14);
      expect(astConfig.hooks.ambientLeafHooks.size).toBe(20);
      expect(astConfig.hooks.knownContextHooks.size).toBe(7);
      expect(astConfig.hooks.tanstackQueryHooks.size).toBe(6);
      expect(astConfig.sideEffects.consoleMethods.size).toBe(8);
      expect(astConfig.testing.boundaryPackages.size).toBe(15);
      expect(astConfig.testing.boundaryGlobals.size).toBe(7);
    });
  });

  describe('immutability', () => {
    it('config object is frozen', () => {
      expect(Object.isFrozen(astConfig)).toBe(true);
    });

    it('nested section objects are frozen', () => {
      expect(Object.isFrozen(astConfig.react)).toBe(true);
      expect(Object.isFrozen(astConfig.hooks)).toBe(true);
      expect(Object.isFrozen(astConfig.effects)).toBe(true);
      expect(Object.isFrozen(astConfig.testing)).toBe(true);
    });
  });

  describe('PRIORITY_RULES', () => {
    it('is a non-empty array', () => {
      expect(PRIORITY_RULES.length).toBeGreaterThan(0);
    });

    it('has 25 entries', () => {
      expect(PRIORITY_RULES).toHaveLength(25);
    });

    it('every entry has kind, condition, and priority', () => {
      for (const rule of PRIORITY_RULES) {
        expect(rule.kind).toBeTruthy();
        expect(rule.condition).toBeTruthy();
        expect(rule.priority).toMatch(/^P[1-5]$/);
      }
    });

    it('contains all five priority levels', () => {
      const priorities = new Set(PRIORITY_RULES.map(r => r.priority));
      expect(priorities).toEqual(new Set(['P1', 'P2', 'P3', 'P4', 'P5']));
    });
  });

  describe('lookupPriority', () => {
    describe('bug kind', () => {
      it('returns P1 for authz subKind', () => {
        expect(lookupPriority('bug', { subKind: 'authz' })).toBe('P1');
      });

      it('returns P1 for crash subKind', () => {
        expect(lookupPriority('bug', { subKind: 'crash' })).toBe('P1');
      });

      it('returns P1 for CVE-critical subKind', () => {
        expect(lookupPriority('bug', { subKind: 'CVE-critical' })).toBe('P1');
      });

      it('returns P2 for CVE-high subKind', () => {
        expect(lookupPriority('bug', { subKind: 'CVE-high' })).toBe('P2');
      });

      it('returns P2 for bug with no subKind (conservative default)', () => {
        expect(lookupPriority('bug')).toBe('P2');
      });

      it('returns P2 for bug with unknown subKind', () => {
        expect(lookupPriority('bug', { subKind: 'unknown' })).toBe('P2');
      });
    });

    describe('complexity-hotspot kind', () => {
      it('returns P1 when CC >= 25', () => {
        expect(lookupPriority('complexity-hotspot', { cyclomaticComplexity: 25 })).toBe('P1');
        expect(lookupPriority('complexity-hotspot', { cyclomaticComplexity: 30 })).toBe('P1');
      });

      it('returns P2 when 15 <= CC < 25', () => {
        expect(lookupPriority('complexity-hotspot', { cyclomaticComplexity: 15 })).toBe('P2');
        expect(lookupPriority('complexity-hotspot', { cyclomaticComplexity: 24 })).toBe('P2');
      });

      it('returns P3 when CC < 15', () => {
        expect(lookupPriority('complexity-hotspot', { cyclomaticComplexity: 14 })).toBe('P3');
        expect(lookupPriority('complexity-hotspot', { cyclomaticComplexity: 0 })).toBe('P3');
      });

      it('returns P3 when no CC context provided', () => {
        expect(lookupPriority('complexity-hotspot')).toBe('P3');
      });
    });

    describe('test-gap kind', () => {
      it('returns P2 for HIGH risk', () => {
        expect(lookupPriority('test-gap', { risk: 'HIGH' })).toBe('P2');
      });

      it('returns P3 for MEDIUM risk', () => {
        expect(lookupPriority('test-gap', { risk: 'MEDIUM' })).toBe('P3');
      });

      it('returns P4 for LOW risk', () => {
        expect(lookupPriority('test-gap', { risk: 'LOW' })).toBe('P4');
      });

      it('returns P3 for unknown risk level', () => {
        expect(lookupPriority('test-gap', { risk: 'UNKNOWN' })).toBe('P3');
      });

      it('returns P3 for test-gap with no context', () => {
        expect(lookupPriority('test-gap')).toBe('P3');
      });
    });

    describe('mock-internal kind', () => {
      it('returns P3 for high confidence', () => {
        expect(lookupPriority('mock-internal', { confidence: 'high' })).toBe('P3');
      });

      it('returns P4 for medium confidence', () => {
        expect(lookupPriority('mock-internal', { confidence: 'medium' })).toBe('P4');
      });

      it('returns P4 for low confidence', () => {
        expect(lookupPriority('mock-internal', { confidence: 'low' })).toBe('P4');
      });

      it('returns P4 for mock-internal with no context', () => {
        expect(lookupPriority('mock-internal')).toBe('P4');
      });
    });

    describe('circular-dep kind', () => {
      it('returns P5 when type-only', () => {
        expect(lookupPriority('circular-dep', { isTypeOnly: true })).toBe('P5');
      });

      it('returns P4 when not type-only', () => {
        expect(lookupPriority('circular-dep', { isTypeOnly: false })).toBe('P4');
      });

      it('returns P4 for circular-dep with no context', () => {
        expect(lookupPriority('circular-dep')).toBe('P4');
      });
    });

    describe('unconditional kinds', () => {
      it('returns P2 for trust-boundary-gap', () => {
        expect(lookupPriority('trust-boundary-gap')).toBe('P2');
      });

      it('returns P3 for ddau-violation', () => {
        expect(lookupPriority('ddau-violation')).toBe('P3');
      });

      it('returns P3 for eliminable-effect', () => {
        expect(lookupPriority('eliminable-effect')).toBe('P3');
      });

      it('returns P3 for cross-domain-coupling', () => {
        expect(lookupPriority('cross-domain-coupling')).toBe('P3');
      });

      it('returns P4 for dead-export', () => {
        expect(lookupPriority('dead-export')).toBe('P4');
      });

      it('returns P4 for as-any', () => {
        expect(lookupPriority('as-any')).toBe('P4');
      });

      it('returns P4 for non-null-assertion', () => {
        expect(lookupPriority('non-null-assertion')).toBe('P4');
      });

      it('returns P4 for missing-concern', () => {
        expect(lookupPriority('missing-concern')).toBe('P4');
      });

      it('returns P4 for handler-inline-logic', () => {
        expect(lookupPriority('handler-inline-logic')).toBe('P4');
      });

      it('returns P4 for branded-type-gap', () => {
        expect(lookupPriority('branded-type-gap')).toBe('P4');
      });

      it('returns P5 for style', () => {
        expect(lookupPriority('style')).toBe('P5');
      });
    });

    describe('unknown kinds', () => {
      it('returns P4 for unknown kind', () => {
        expect(lookupPriority('unknown-kind')).toBe('P4');
      });

      it('returns P4 for empty string kind', () => {
        expect(lookupPriority('')).toBe('P4');
      });

      it('returns P4 for made-up kind', () => {
        expect(lookupPriority('foo-bar-baz')).toBe('P4');
      });
    });
  });
});
