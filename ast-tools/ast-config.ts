import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Centralized repo convention config for AST tools.
 *
 * This file is the single source of truth for all repo-specific conventions
 * currently hardcoded across the AST tools. It consolidates patterns from
 * types.ts, shared.ts, and all individual tool files into one location.
 *
 * Conventions are organized by domain (react, hooks, effects, etc.).
 * All values are frozen and readonly to prevent accidental mutation.
 */

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface AstConfig {
  readonly react: {
    readonly builtinHooks: ReadonlySet<string>;
    readonly hookOptionProperties: ReadonlySet<string>;
    readonly jsxReturnTypeMarkers: readonly string[];
    readonly wrapperHocMap: Readonly<Record<string, 'memo' | 'forwardRef'>>;
  };

  readonly hooks: {
    readonly ambientLeafHooks: ReadonlySet<string>;
    readonly knownContextHooks: ReadonlySet<string>;
    readonly tanstackQueryHooks: ReadonlySet<string>;
    readonly serviceHookPathPatterns: readonly string[];
    readonly contextHookPathPatterns: readonly string[];
    readonly domUtilityPathPatterns: readonly string[];
    readonly scopeHookSuffix: string;
  };

  readonly effects: {
    readonly effectHookNames: ReadonlySet<string>;
    readonly fetchFunctions: ReadonlySet<string>;
    readonly timerFunctions: ReadonlySet<string>;
    readonly routerNavMethods: ReadonlySet<string>;
    readonly routerObjectNames: readonly string[];
    readonly storageObjects: ReadonlySet<string>;
    readonly storageIdentifiers: ReadonlySet<string>;
    readonly navigateFunctions: ReadonlySet<string>;
    readonly dispatchIdentifiers: ReadonlySet<string>;
    readonly toastObjectNames: readonly string[];
    readonly axiosIdentifiers: readonly string[];
  };

  readonly sideEffects: {
    readonly consoleMethods: ReadonlySet<string>;
    readonly timerFunctions: ReadonlySet<string>;
    readonly posthogDirectCalls: ReadonlySet<string>;
    readonly posthogMethodCalls: ReadonlySet<string>;
    readonly windowMutationCalls: ReadonlySet<string>;
  };

  readonly storage: {
    readonly directStorageMethods: ReadonlySet<string>;
    readonly typedStorageHelpers: Readonly<Record<string, string>>;
    readonly cookieMethods: ReadonlySet<string>;
    readonly directStorageTypeMap: Readonly<Record<string, string>>;
  };

  readonly env: {
    readonly wrapperIdentifiers: Readonly<Record<string, string>>;
    readonly clientEnvPathPatterns: readonly string[];
    readonly serverEnvPathPatterns: readonly string[];
    readonly treeShakingCommentMarkers: readonly string[];
  };

  readonly featureFlags: {
    readonly flagHooks: ReadonlySet<string>;
    readonly pageGuardHook: string;
    readonly flagBindingName: string;
    readonly overrideFunctions: ReadonlySet<string>;
    readonly tabGateProperty: string;
  };

  readonly dataLayer: {
    readonly queryHookSuffix: string;
    readonly mutationHookSuffix: string;
    readonly queryKeyFactorySuffix: string;
    readonly fetchApiIdentifiers: ReadonlySet<string>;
    readonly invalidateMethod: string;
    readonly apiPathMarker: string;
  };

  readonly typeSafety: {
    readonly trustBoundaryCalls: ReadonlySet<string>;
    readonly trustBoundaryMethodCalls: ReadonlySet<string>;
    readonly trustBoundaryPropertyAccess: ReadonlySet<string>;
    readonly guardLookbackDistance: number;
  };

  readonly testing: {
    readonly boundaryPackages: ReadonlySet<string>;
    readonly boundaryGlobals: ReadonlySet<string>;
    readonly boundaryFunctionNames: ReadonlySet<string>;
    readonly boundaryPathPatterns: readonly string[];
    readonly testingLibraryQueries: ReadonlySet<string>;
    readonly userVisibleMatchers: ReadonlySet<string>;
    readonly snapshotMatchers: ReadonlySet<string>;
    readonly calledMatchers: ReadonlySet<string>;
    readonly playwrightSources: ReadonlySet<string>;
    readonly nonPureTestNames: ReadonlySet<string>;
    readonly mockRestorePatterns: readonly string[];
    readonly storageClearPatterns: readonly string[];
    readonly testHelperPathPatterns: readonly string[];
    readonly fixtureImportPatterns: readonly string[];
    readonly sharedMutablePatterns: readonly string[];
    readonly providerSignals: readonly string[];
    readonly domainDirMarkers: readonly string[];
    readonly deleteThresholdInternalMocks: number;
  };

  readonly jsx: {
    readonly arrayTransformMethods: ReadonlySet<string>;
    readonly thresholds: Readonly<{
      chainedTernaryDepth: number;
      complexGuardConditions: number;
      inlineTransformChain: number;
      multiStmtHandler: number;
      complexClassNameTernaries: number;
    }>;
  };

  readonly complexity: Record<string, never>;

  readonly ownership: {
    readonly layoutExceptions: ReadonlySet<string>;
    readonly containerSuffixes: readonly string[];
    readonly containerDirectories: readonly string[];
    readonly routerHooks: ReadonlySet<string>;
  };

  readonly fileDiscovery: {
    readonly skipDirs: ReadonlySet<string>;
    readonly excludedTestSuffixes: readonly string[];
    readonly moduleResolutionExtensions: readonly string[];
    readonly pathAliasPrefix: string;
  };

  readonly testParity: {
    readonly authMethods: readonly string[];
    readonly pageObjects: ReadonlySet<string>;
    readonly pomSuffix: string;
    /**
     * Maps source spec filenames to target spec filenames.
     * Used by the interpreter to pair files across suites.
     */
    readonly fileMapping: Readonly<Record<string, string>>;
    /**
     * Directories (relative to the spec directory's parent) to scan
     * for helper/POM files when building the helper assertion index.
     */
    readonly helperDirs: readonly string[];
  };

  readonly intentMatcher: {
    /**
     * Weight applied to each observation kind when computing the
     * intention preservation score. Higher weight = more important.
     */
    readonly signalWeights: Readonly<Record<string, number>>;
    /**
     * Score thresholds for the overall intention report.
     * Below `fail` -> fail, between `fail` and `warn` -> warning.
     */
    readonly thresholds: Readonly<{
      fail: number;
      warn: number;
    }>;
    /**
     * Observation kinds to exclude from intent matching.
     * These are structural noise that changes on every refactor.
     */
    readonly ignoredKinds: ReadonlySet<string>;
  };

  readonly vitestParity: {
    readonly testFileExtensions: readonly string[];
    readonly playwrightImports: readonly string[];
    readonly cleanupPatterns: readonly string[];
  };

  readonly brandedCheck: {
    /**
     * Maps property names to their expected branded type name.
     * The tool flags any property signature where the name matches a key
     * and the type annotation is the primitive base type instead of the brand.
     */
    readonly fieldPatterns: Readonly<Record<string, { brandedType: string; baseType: string }>>;
    /** File path substrings to exclude (e.g., schema files, wire-format types) */
    readonly excludePathPatterns: readonly string[];
    /** Containing type/interface name substrings to exclude (e.g., wire-format DTOs) */
    readonly excludeTypeNamePatterns: readonly string[];
  };

  readonly imports: {
    readonly nextJsPagePrefix: string;
  };

  readonly truncation: {
    readonly defaultMaxLength: number;
    readonly assertionMaxLength: number;
    readonly mockFactoryMaxLength: number;
  };
}

// ---------------------------------------------------------------------------
// Config object
// ---------------------------------------------------------------------------

export const astConfig: AstConfig = Object.freeze({
  react: Object.freeze({
    builtinHooks: new Set([
      'useState',
      'useRef',
      'useMemo',
      'useCallback',
      'useReducer',
      'useId',
      'useDeferredValue',
      'useTransition',
      'useSyncExternalStore',
      'useEffect',
      'useLayoutEffect',
      'useContext',
      'useImperativeHandle',
      'useDebugValue',
    ]) as ReadonlySet<string>,

    hookOptionProperties: new Set([
      'queryFn',
      'mutationFn',
      'onSuccess',
      'onError',
      'onSettled',
      'onMutate',
      'select',
      'enabled',
    ]) as ReadonlySet<string>,

    jsxReturnTypeMarkers: ['JSX', 'ReactNode', 'ReactElement'] as const,

    wrapperHocMap: Object.freeze({
      memo: 'memo',
      'React.memo': 'memo',
      forwardRef: 'forwardRef',
      'React.forwardRef': 'forwardRef',
    } as const),
  }),

  hooks: Object.freeze({
    ambientLeafHooks: new Set([
      // UI utilities
      'useBreakpoints',
      'useWindowSize',
      'useDropdownScrollHandler',
      'useClickAway',
      'useScrollCallback',
      'usePagination',
      'useSorting',
      'useTheme',
      'useTranslation',
      // Router hooks (Next.js)
      'useRouter',
      'usePathname',
      'useSearchParams',
      // Form library hooks (react-hook-form)
      'useForm',
      'useWatch',
      'useFormContext',
      'useController',
      'useFieldArray',
      'useFormState',
    ]) as ReadonlySet<string>,

    knownContextHooks: new Set([
      'useAuthState',
      'usePosthogContext',
      'useTeams',
      'useUsers',
      'useFlyoutContext',
      'useInsightsContext',
      'useBpoProjectContext',
    ]) as ReadonlySet<string>,

    tanstackQueryHooks: new Set([
      'useQuery',
      'useMutation',
      'useInfiniteQuery',
      'useQueryClient',
      'useIsFetching',
      'useIsMutating',
    ]) as ReadonlySet<string>,

    serviceHookPathPatterns: ['services/hooks'] as const,
    contextHookPathPatterns: ['providers/', 'context/'] as const,
    domUtilityPathPatterns: ['shared/hooks'] as const,
    scopeHookSuffix: 'Scope',
  }),

  effects: Object.freeze({
    effectHookNames: new Set(['useEffect', 'useLayoutEffect']) as ReadonlySet<string>,

    fetchFunctions: new Set(['fetch', 'fetchApi']) as ReadonlySet<string>,

    timerFunctions: new Set(['setTimeout', 'setInterval', 'requestAnimationFrame']) as ReadonlySet<string>,

    routerNavMethods: new Set(['push', 'replace']) as ReadonlySet<string>,

    routerObjectNames: ['router'] as const,

    storageObjects: new Set(['localStorage', 'sessionStorage']) as ReadonlySet<string>,

    storageIdentifiers: new Set([
      'localStorage',
      'sessionStorage',
      'readStorage',
      'writeStorage',
      'removeStorage',
    ]) as ReadonlySet<string>,

    navigateFunctions: new Set(['navigate']) as ReadonlySet<string>,

    dispatchIdentifiers: new Set(['dispatch']) as ReadonlySet<string>,

    toastObjectNames: ['toast'] as const,
    axiosIdentifiers: ['axios'] as const,
  }),

  sideEffects: Object.freeze({
    consoleMethods: new Set(['log', 'debug', 'info', 'warn', 'error', 'trace', 'dir', 'table']) as ReadonlySet<string>,

    timerFunctions: new Set([
      'setTimeout',
      'setInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'clearTimeout',
      'clearInterval',
    ]) as ReadonlySet<string>,

    posthogDirectCalls: new Set(['sendPosthogEvent']) as ReadonlySet<string>,

    posthogMethodCalls: new Set(['capture', 'identify', 'reset', 'register']) as ReadonlySet<string>,

    windowMutationCalls: new Set(['pushState', 'replaceState', 'open']) as ReadonlySet<string>,
  }),

  storage: Object.freeze({
    directStorageMethods: new Set(['getItem', 'setItem', 'removeItem', 'clear']) as ReadonlySet<string>,

    typedStorageHelpers: Object.freeze({
      readStorage: 'TYPED_STORAGE_READ',
      writeStorage: 'TYPED_STORAGE_WRITE',
      removeStorage: 'TYPED_STORAGE_REMOVE',
    }),

    cookieMethods: new Set(['get', 'set', 'remove']) as ReadonlySet<string>,

    directStorageTypeMap: Object.freeze({
      localStorage: 'DIRECT_LOCAL_STORAGE',
      sessionStorage: 'DIRECT_SESSION_STORAGE',
    }),
  }),

  env: Object.freeze({
    wrapperIdentifiers: Object.freeze({
      clientEnv: 'CLIENT_ENV_ACCESS',
      serverEnv: 'SERVER_ENV_ACCESS',
    }),

    clientEnvPathPatterns: ['env/clientEnv', 'lib/env/clientEnv'] as const,
    serverEnvPathPatterns: ['env/serverEnv', 'lib/env/serverEnv'] as const,
    treeShakingCommentMarkers: ['eslint-disable', 'tree-shak'] as const,
  }),

  featureFlags: Object.freeze({
    flagHooks: new Set(['usePosthogContext', 'useFeatureFlags']) as ReadonlySet<string>,

    pageGuardHook: 'useFeatureFlagPageGuard',
    flagBindingName: 'featureFlags',

    overrideFunctions: new Set(['__setFeatureFlags', '__clearFeatureFlags']) as ReadonlySet<string>,

    tabGateProperty: 'featureFlag',
  }),

  dataLayer: Object.freeze({
    queryHookSuffix: 'Query',
    mutationHookSuffix: 'Mutation',
    queryKeyFactorySuffix: 'Keys',

    fetchApiIdentifiers: new Set(['fetchApi', 'useFetchApi']) as ReadonlySet<string>,

    invalidateMethod: 'invalidateQueries',
    apiPathMarker: '/api/',
  }),

  typeSafety: Object.freeze({
    trustBoundaryCalls: new Set(['JSON.parse', 'readStorage']) as ReadonlySet<string>,

    trustBoundaryMethodCalls: new Set(['.json']) as ReadonlySet<string>,

    trustBoundaryPropertyAccess: new Set([
      'localStorage.getItem',
      'sessionStorage.getItem',
      'process.env',
    ]) as ReadonlySet<string>,

    guardLookbackDistance: 3,
  }),

  testing: Object.freeze({
    boundaryPackages: new Set([
      'next/router',
      'next/navigation',
      'posthog-js',
      'firebase',
      'firebase/auth',
      'firebase/app',
      'firebase/database',
      'firebase/firestore',
      'firebase/functions',
      'firebase/storage',
      'firebase-admin',
      'firebase-admin/auth',
      'fs',
      'crypto',
      'process',
    ]) as ReadonlySet<string>,

    boundaryGlobals: new Set([
      'window',
      'document',
      'console',
      'navigator',
      'location',
      'localStorage',
      'sessionStorage',
    ]) as ReadonlySet<string>,

    boundaryFunctionNames: new Set([
      'fetch',
      'fetchApi',
      'useFetchApi',
      'localStorage',
      'sessionStorage',
    ]) as ReadonlySet<string>,

    boundaryPathPatterns: ['fetchApi', 'useFetchApi', 'firebase', 'typedStorage', 'posthog'] as const,

    testingLibraryQueries: new Set([
      'getByText',
      'getByRole',
      'getByLabelText',
      'getByPlaceholderText',
      'getByDisplayValue',
      'getByAltText',
      'getByTitle',
      'getByTestId',
      'queryByText',
      'queryByRole',
      'queryByLabelText',
      'queryByPlaceholderText',
      'queryByDisplayValue',
      'queryByAltText',
      'queryByTitle',
      'queryByTestId',
      'findByText',
      'findByRole',
      'findByLabelText',
      'findByPlaceholderText',
      'findByDisplayValue',
      'findByAltText',
      'findByTitle',
      'findByTestId',
      'getAllByText',
      'getAllByRole',
      'getAllByLabelText',
      'getAllByTestId',
      'queryAllByText',
      'queryAllByRole',
      'queryAllByTestId',
      'findAllByText',
      'findAllByRole',
      'findAllByTestId',
    ]) as ReadonlySet<string>,

    userVisibleMatchers: new Set([
      'toBeVisible',
      'toBeInTheDocument',
      'toHaveTextContent',
      'toBeDisabled',
      'toBeEnabled',
      'toHaveAccessibleName',
      'toHaveAccessibleDescription',
    ]) as ReadonlySet<string>,

    snapshotMatchers: new Set(['toMatchSnapshot', 'toMatchInlineSnapshot']) as ReadonlySet<string>,

    calledMatchers: new Set([
      'toHaveBeenCalled',
      'toHaveBeenCalledWith',
      'toHaveBeenCalledTimes',
    ]) as ReadonlySet<string>,

    playwrightSources: new Set(['@playwright/test']) as ReadonlySet<string>,

    nonPureTestNames: new Set([
      'render',
      'renderHook',
      'expect',
      'describe',
      'it',
      'test',
      'beforeEach',
      'afterEach',
      'beforeAll',
      'afterAll',
      'vi',
      'jest',
      'screen',
      'within',
      'waitFor',
      'act',
      'cleanup',
      'fireEvent',
      'userEvent',
    ]) as ReadonlySet<string>,

    mockRestorePatterns: ['restoreAllMocks', 'clearAllMocks', 'resetAllMocks'] as const,

    storageClearPatterns: ['localStorage.clear', 'sessionStorage.clear'] as const,

    testHelperPathPatterns: ['__tests__/helpers', 'test-utils', 'test-helpers', 'vitest', '@testing-library'] as const,

    fixtureImportPatterns: ['fixtures', '@/fixtures'] as const,

    sharedMutablePatterns: ['__tests__/constants', 'test-constants'] as const,

    providerSignals: ['QueryClientProvider', 'QueryClient(', 'AuthProvider', 'wrapper:', 'renderWith'] as const,

    domainDirMarkers: ['dashboard', 'hooks'] as const,

    deleteThresholdInternalMocks: 3,
  }),

  jsx: Object.freeze({
    arrayTransformMethods: new Set(['filter', 'map', 'reduce', 'sort', 'flatMap', 'find']) as ReadonlySet<string>,

    thresholds: Object.freeze({
      chainedTernaryDepth: 2,
      complexGuardConditions: 3,
      inlineTransformChain: 2,
      multiStmtHandler: 2,
      complexClassNameTernaries: 2,
    }),
  }),

  complexity: Object.freeze({}),

  ownership: Object.freeze({
    layoutExceptions: new Set([
      'DashboardLayout',
      'SignedInPageShell',
      'Sidebar',
      'ProfileMenu',
      'RequireRoles',
      'RequireLoginMaybe',
      'Redirect',
    ]) as ReadonlySet<string>,

    containerSuffixes: ['Container'] as const,

    containerDirectories: ['containers/'] as const,

    routerHooks: new Set([
      'useRouter',
      'usePathname',
      'useSearchParams',
      'useQueryState',
      'useQueryStates',
    ]) as ReadonlySet<string>,
  }),

  fileDiscovery: Object.freeze({
    skipDirs: new Set(['node_modules', '.next', 'dist']) as ReadonlySet<string>,

    excludedTestSuffixes: ['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx', '.d.ts'] as const,

    moduleResolutionExtensions: ['.ts', '.tsx', '/index.ts', '/index.tsx'] as const,

    pathAliasPrefix: '@/',
  }),

  testParity: Object.freeze({
    authMethods: ['signInWithEmulator', 'signInAsONELOGINAdmin', 'signInAsMember', 'signIn'] as const,

    pageObjects: new Set(['page', 'context']) as ReadonlySet<string>,

    pomSuffix: 'Page',

    fileMapping: {
      'auth.spec.ts': 'auth.spec.ts',
      'bpo.spec.ts': 'bpo.spec.ts',
      'exportInsightsTabs.spec.ts': 'export.spec.ts',
      'generalComponents.spec.ts': 'components.spec.ts',
      'mockDataAnalyzer.spec.ts': 'analyzer.spec.ts',
      'mockDataFavorites.spec.ts': 'favorites.spec.ts',
      'mockDataMicroworkflows.spec.ts': 'microworkflows.spec.ts',
      'mockDataRealTime.spec.ts': 'realtime.spec.ts',
      'mockDataRelays.spec.ts': 'relays.spec.ts',
      'mockDataSystems.spec.ts': 'systems.spec.ts',
      'mockDataSystemLatency.spec.ts': 'system-latency.spec.ts',
      'mockDataTeamProductivity.spec.ts': 'team-productivity.spec.ts',
      'mockDataUserProductivity.spec.ts': 'user-productivity.spec.ts',
      'mockDataWorkstreams.spec.ts': 'analyzer.spec.ts',
      'projects.spec.ts': 'projects.spec.ts',
      'teams.spec.ts': 'teams.spec.ts',
      'userAssignmentsTeams.spec.ts': 'assignments.spec.ts',
      'users.spec.ts': 'users.spec.ts',
    } as Record<string, string>,

    helperDirs: ['utils', 'pages'] as const,

    /** Directory path substring that identifies a mock-handler-baseline target suite.
     *  When the target dir matches, route intercept weight normalization is applied. */
    mockHandlerBaselineMarker: 'integration' as const,
  }),

  intentMatcher: Object.freeze({
    signalWeights: Object.freeze({
      // High-signal: behavior-defining observations
      HOOK_CALL: 2.0,
      EFFECT_LOCATION: 2.0,
      EFFECT_FETCH_CALL: 2.0,
      EFFECT_NAVIGATION_CALL: 2.0,
      EFFECT_STORAGE_CALL: 2.0,
      EFFECT_TOAST_CALL: 2.0,
      QUERY_HOOK_DEFINITION: 2.0,
      MUTATION_HOOK_DEFINITION: 2.0,
      FETCH_API_CALL: 2.0,
      COMPONENT_DECLARATION: 1.5,
      PROP_FIELD: 1.5,
      // Medium-signal: structural observations
      STATIC_IMPORT: 1.0,
      EXPORT_DECLARATION: 1.0,
      FUNCTION_COMPLEXITY: 0.5,
      CONSOLE_CALL: 1.0,
      TOAST_CALL: 1.5,
      TIMER_CALL: 1.0,
      POSTHOG_CALL: 1.5,
      WINDOW_MUTATION: 1.5,
      DIRECT_STORAGE_CALL: 1.5,
      TYPED_STORAGE_CALL: 1.0,
      PROCESS_ENV_ACCESS: 1.0,
      ENV_WRAPPER_ACCESS: 0.5,
      FLAG_HOOK_CALL: 1.5,
      FLAG_READ: 1.0,
      PAGE_GUARD: 2.0,
      AS_ANY_CAST: 0.5,
      NON_NULL_ASSERTION: 0.5,
      _default: 1.0,
    } as Record<string, number>),

    thresholds: Object.freeze({
      fail: 0.6,
      warn: 0.8,
    }),

    ignoredKinds: new Set([
      // Structural noise that changes on every refactor
      'DYNAMIC_IMPORT',
      'REEXPORT_IMPORT',
      'SIDE_EFFECT_IMPORT',
      'CIRCULAR_DEPENDENCY',
      'DEAD_EXPORT_CANDIDATE',
      'JSX_RETURN_BLOCK',
      'JSX_INLINE_STYLE',
      'JSX_COMPLEX_CLASSNAME',
      'EFFECT_DEP_ENTRY',
      'EFFECT_CLEANUP_PRESENT',
      'EFFECT_REF_TOUCH',
      'ENV_WRAPPER_IMPORT',
      'RAW_ENV_IMPORT',
    ]) as ReadonlySet<string>,
  }),

  vitestParity: Object.freeze({
    testFileExtensions: ['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx'] as const,
    playwrightImports: ['@playwright/test', '../fixture', './fixture'] as const,
    cleanupPatterns: [
      'vi.useRealTimers',
      'vi.restoreAllMocks',
      'vi.clearAllMocks',
      'localStorage.clear',
      'sessionStorage.clear',
      'fetchMock.resetMocks',
      'cleanup',
    ] as const,
  }),

  brandedCheck: Object.freeze({
    fieldPatterns: Object.freeze({
      userId: { brandedType: 'UserId', baseType: 'string' },
      teamId: { brandedType: 'TeamId', baseType: 'number' },
      workstreamId: { brandedType: 'WorkstreamId', baseType: 'string' },
      organizationId: { brandedType: 'OrganizationId', baseType: 'number' },
    } as Record<string, { brandedType: string; baseType: string }>),

    excludePathPatterns: [
      '.schema.ts', // Zod schema files define the parse boundary
      '.spec.ts', // Test files
      '.spec.tsx',
      '.test.ts',
      '.test.tsx',
      '.fixture.ts', // Fixture builders use branded constructors
      'brand.ts', // Brand definitions themselves
    ] as const,

    excludeTypeNamePatterns: [
      'Response', // Wire-format types legitimately use primitives
      'Request',
      'Wire',
      'Raw',
      'Dto',
      'DTO',
      'Payload',
    ] as const,
  }),

  imports: Object.freeze({
    nextJsPagePrefix: 'src/pages/',
  }),

  truncation: Object.freeze({
    defaultMaxLength: 80,
    assertionMaxLength: 120,
    mockFactoryMaxLength: 200,
  }),
}) satisfies AstConfig;

// ---------------------------------------------------------------------------
// Config-from-repo override
// ---------------------------------------------------------------------------

/** Filename to look for in the project root for repo-specific overrides. */
const PROJECT_CONFIG_FILENAME = '.ast-config.json';

/**
 * Deep-merge a partial JSON config onto the frozen defaults.
 *
 * Arrays replace (not concatenate). Objects merge recursively.
 * Set-typed fields accept arrays in JSON and are converted to Sets.
 */
function mergeConfig(base: AstConfig, overrides: Record<string, unknown>): AstConfig {
  const result: Record<string, unknown> = {};

  for (const [sectionKey, sectionValue] of Object.entries(base)) {
    const overrideSection = overrides[sectionKey];

    if (!overrideSection || typeof overrideSection !== 'object' || typeof sectionValue !== 'object') {
      result[sectionKey] = sectionValue;
      continue;
    }

    const merged: Record<string, unknown> = {};
    const baseSection = sectionValue as Record<string, unknown>;
    const overSection = overrideSection as Record<string, unknown>;

    for (const [key, baseVal] of Object.entries(baseSection)) {
      const overVal = overSection[key];

      if (overVal === undefined) {
        merged[key] = baseVal;
      } else if (baseVal instanceof Set && Array.isArray(overVal)) {
        // JSON arrays become Sets for Set-typed config fields
        merged[key] = new Set(overVal as string[]);
      } else if (
        baseVal !== null &&
        typeof baseVal === 'object' &&
        !Array.isArray(baseVal) &&
        !(baseVal instanceof Set)
      ) {
        // Nested objects (e.g., thresholds) merge recursively
        merged[key] = Object.freeze({
          ...(baseVal as Record<string, unknown>),
          ...(overVal as Record<string, unknown>),
        });
      } else {
        // Scalars and arrays replace directly
        merged[key] = overVal;
      }
    }

    // Include override keys not present in base (forward-compatible)
    for (const [key, overVal] of Object.entries(overSection)) {
      if (!(key in baseSection)) {
        merged[key] = overVal;
      }
    }

    result[sectionKey] = Object.freeze(merged);
  }

  return Object.freeze(result) as AstConfig;
}

let resolvedConfig: AstConfig | null = null;

/**
 * Resolve the effective config by merging project-level overrides onto defaults.
 *
 * Looks for `.ast-config.json` at the project root (determined by `PROJECT_ROOT`
 * from `project.ts`). If found, deep-merges the JSON onto the built-in defaults.
 * If not found, returns the built-in config unchanged.
 *
 * The result is cached after the first call.
 *
 * For standalone/external use:
 *   1. Set `AST_PROJECT_ROOT` env var to point at your repo
 *   2. Create `.ast-config.json` in your repo root with overrides
 *   3. Run tools via `npx tsx ast-tools/ast-complexity.ts src/`
 *
 * The JSON file uses the same structure as `AstConfig`, with two differences:
 *   - Set fields accept JSON arrays (e.g., `"ambientLeafHooks": ["useBreakpoints"]`)
 *   - Only include the sections/fields you want to override; defaults apply to the rest
 */
export function resolveConfig(): AstConfig {
  if (resolvedConfig) return resolvedConfig;

  try {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFile);
    const projectRoot = process.env.AST_PROJECT_ROOT
      ? path.resolve(process.env.AST_PROJECT_ROOT)
      : path.resolve(currentDir, '../..');
    const configPath = path.join(projectRoot, PROJECT_CONFIG_FILENAME);

    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const overrides = JSON.parse(raw) as Record<string, unknown>;
      resolvedConfig = mergeConfig(astConfig, overrides);
    } else {
      resolvedConfig = astConfig;
    }
  } catch {
    // If anything fails (missing file, parse error), use defaults
    resolvedConfig = astConfig;
  }

  return resolvedConfig;
}

export type { AstConfig };
