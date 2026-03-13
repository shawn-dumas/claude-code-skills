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

  imports: Object.freeze({
    nextJsPagePrefix: 'src/pages/',
  }),

  truncation: Object.freeze({
    defaultMaxLength: 80,
    assertionMaxLength: 120,
    mockFactoryMaxLength: 200,
  }),
}) satisfies AstConfig;

export type { AstConfig };
