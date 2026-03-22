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
    readonly queryCacheClearPatterns: readonly string[];
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

  readonly handlerStructure: {
    /** Lines of non-delegation logic in handler body above which HANDLER_INLINE_LOGIC is emitted */
    readonly inlineLogicThreshold: number;
  };

  readonly testCoverage: {
    /** Risk thresholds: riskScore = (maxCC / 5) + (lineCount / 100) + (consumerCount / 10) */
    readonly riskHighThreshold: number;
    readonly riskMediumThreshold: number;
  };

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
    /** Parameter names to exclude from UNBRANDED_PARAM detection (common generic names that happen to match field patterns) */
    readonly paramExcludeNames: ReadonlySet<string>;
  };

  readonly planAudit: {
    // --- Observation layer ---
    /** Header fields that must appear in the plan blockquote header. */
    readonly requiredHeaderFields: readonly string[];
    /** Regex patterns (as strings) for specific header field formats. Keyed by field name. */
    readonly headerFormats: Readonly<Record<string, string>>;
    /** Heading text patterns that identify a verification section. */
    readonly verificationHeadingPatterns: readonly string[];
    /** Maximum heading depth (h1=1, h2=2, ...) to search for verification headings. */
    readonly verificationMaxDepth: number;
    /** Patterns that identify a cleanup file reference in plan text. */
    readonly cleanupPatterns: readonly string[];
    /** Patterns that count as a filled standing element value (yes, no, n/a, etc.). */
    readonly standingElementAnswerPatterns: readonly string[];
    /** Strings that count as a valid prompt mode value. */
    readonly validPromptModes: readonly string[];
    /** Regex patterns for naming convention references. */
    readonly namingConventionPatterns: readonly string[];
    /** Regex patterns for client-side aggregation signals. */
    readonly aggregationPatterns: readonly string[];
    /** Regex patterns for deferred-to-cleanup references. */
    readonly deferredCleanupPatterns: readonly string[];
    /** Regex pattern for file path references in plan text. */
    readonly filePathPattern: string;
    /** Regex pattern for skill references in plan text. */
    readonly skillReferencePattern: string;
    // --- Interpreter ---
    /**
     * Severity assigned to each observation kind.
     * 'blocker' forces BLOCKED regardless of score.
     * 'warning' subtracts from score.
     * 'info' is noted but does not affect verdict.
     */
    readonly severityMap: Readonly<Record<string, 'blocker' | 'warning' | 'info'>>;
    /** Points subtracted per observation kind. Only applied for blocker/warning severity. */
    readonly checkWeights: Readonly<Record<string, number>>;
    /** Score thresholds for the rollup verdict. Score starts at 100. */
    readonly verdictThresholds: Readonly<{
      /** Score >= this -> CERTIFIED */
      certified: number;
      /** Score >= this -> CONDITIONAL; below -> BLOCKED */
      conditional: number;
    }>;
  };

  readonly skillQuality: {
    /** Category-specific required sections. Key is the category, value is heading text patterns. */
    readonly requiredSections: Readonly<
      Record<string, readonly { readonly pattern: string; readonly label: string }[]>
    >;
    /** Category-specific required section roles. Key is the category, value is role names. */
    readonly requiredRoles: Readonly<Record<string, readonly string[]>>;
    /** Deprecated command patterns (regex strings). Commands matching these are flagged. */
    readonly deprecatedCommandPatterns: readonly { readonly pattern: string; readonly replacement: string }[];
  };

  readonly conventions: {
    /**
     * Convention rules for detecting skill drift. Each entry defines:
     * - scope: regex that determines if a skill is relevant to this convention
     *   (matched against the full skill text content)
     * - current: string patterns that indicate the skill references the current convention
     * - superseded: regex patterns that indicate the skill references the old/superseded convention
     * - message: human-readable description of the current convention
     *
     * The observation layer scans code blocks and text for superseded patterns.
     * The interpreter classifies: CONVENTION_DRIFT (has superseded, missing current)
     * or CONVENTION_ALIGNED (references current pattern).
     */
    readonly rules: readonly {
      readonly id: string;
      readonly scope: string; // regex string, matched against full skill text
      readonly current: readonly string[]; // literal substrings to search for
      readonly superseded: readonly string[]; // regex strings to search for
      readonly message: string;
    }[];
  };

  readonly bffGaps: {
    /** Text patterns that identify a BFF stub (searched in file content) */
    readonly stubPatterns: readonly string[];
    /** Path segment that identifies mock routes (e.g., '/mock/') */
    readonly mockSegment: string;
  };

  readonly imports: {
    readonly nextJsPagePrefix: string;
  };

  readonly truncation: {
    readonly defaultMaxLength: number;
    readonly assertionMaxLength: number;
    readonly mockFactoryMaxLength: number;
  };

  readonly authz: {
    readonly canonicalFiles: ReadonlySet<string>;
    readonly rawCheckMethods: ReadonlySet<string>;
    readonly equalityOperators: ReadonlySet<string>;
    /** Roles with no broader family -- equality checks against these are expected. */
    readonly singletonRoles: ReadonlySet<string>;
  };

  readonly displayFormat: {
    readonly placeholderConstant: string;
    readonly placeholderValue: string;
    readonly placeholderImport: string;
    readonly wrongPlaceholders: ReadonlySet<string>;
    readonly formatFunctions: ReadonlySet<string>;
    readonly formatterFilePaths: ReadonlySet<string>;
    readonly rawFormatMethods: ReadonlySet<string>;
    readonly canonicalEmptyMessage: string;
    readonly wrongEmptyMessages: ReadonlySet<string>;
    readonly placeholderStrings: ReadonlySet<string>;
    readonly percentagePrecision: Readonly<{
      tableCell: number;
      chartTooltip: number;
      progressBar: number;
      spaceConstrained: number;
    }>;
  };

  readonly behavioral: {
    /** Minimum string literal length to report as JSX_STRING_LITERAL. Short literals like ":" or "," are noise. */
    readonly jsxStringLiteralMinLength: number;
    /** Known render-cap method names (e.g., 'slice', 'take', 'splice'). */
    readonly renderCapMethods: ReadonlySet<string>;
    /** Known type coercion functions. */
    readonly typeCoercionFunctions: ReadonlySet<string>;
    /** Known type coercion method calls (e.g., 'toString', 'toFixed'). */
    readonly typeCoercionMethods: ReadonlySet<string>;
    /** useState/useQueryState hook names whose arguments are state initializations. */
    readonly stateInitHooks: ReadonlySet<string>;
    /** Column definition helper names (e.g., 'columnHelper.accessor', 'columnHelper.display'). */
    readonly columnDefMethods: ReadonlySet<string>;
    /** Props to skip for DEFAULT_PROP_VALUE (className, style, etc. are not behavioral). */
    readonly ignoredDefaultProps: ReadonlySet<string>;
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
      // URL state hooks (nuqs)
      'useQueryState',
      'useQueryStates',
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
      'toThrow',
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

    queryCacheClearPatterns: ['queryClient.clear', 'queryClient.resetQueries', 'queryClient.removeQueries'] as const,

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

  handlerStructure: Object.freeze({
    inlineLogicThreshold: 15,
  }),

  testCoverage: Object.freeze({
    riskHighThreshold: 3.0,
    riskMediumThreshold: 1.2,
  }),

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
      // Behavioral fingerprint observations (ast-behavioral)
      DEFAULT_PROP_VALUE: 2.0,
      RENDER_CAP: 2.0,
      NULL_COERCION_DISPLAY: 2.0,
      CONDITIONAL_RENDER_GUARD: 1.5,
      JSX_STRING_LITERAL: 1.5,
      COLUMN_DEFINITION: 2.0,
      STATE_INITIALIZATION: 2.0,
      TYPE_COERCION_BOUNDARY: 1.5,
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
      // Behavioral fingerprint overlaps (ast-behavioral emits these, but
      // ast-null-display and ast-jsx-analysis already cover them for intent matching)
      'NULL_COERCION_DISPLAY',
      'CONDITIONAL_RENDER_GUARD',
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

    paramExcludeNames: new Set([
      'displayName',
      'label',
      'message',
      'name',
      'description',
      'title',
      'text',
      'placeholder',
      'className',
      'key',
      'path',
      'url',
      'href',
    ]) as ReadonlySet<string>,
  }),

  planAudit: Object.freeze({
    // --- Observation layer ---
    requiredHeaderFields: ['Complexity', 'Duration', 'Nearest', 'Branch', 'Created'] as const,

    headerFormats: Object.freeze({
      // Tolerate trailing annotations after the core pattern (e.g., parenthetical
      // re-scoring notes, "-- actual:" post-archival annotations)
      Complexity: String.raw`^D\d+\s+S\d+\s+Z\d+\s*=\s*\d+(\.\d+)?(\s|$)`,
      Duration: String.raw`^F\d+\s+C\d+\s*=\s*\d+(\.\d+)?h\s*\(\d+(\.\d+)?-\d+(\.\d+)?h\)`,
    } as Record<string, string>),

    verificationHeadingPatterns: ['verification checklist', 'pre-execution verification', 'verification'] as const,

    verificationMaxDepth: 2,

    cleanupPatterns: [String.raw`-cleanup\.md\b`, String.raw`\bcleanup\s+file\b`] as const,

    standingElementAnswerPatterns: [String.raw`\b(yes|no|n\/a|not needed|not applicable)\b`] as const,

    validPromptModes: ['auto', 'manual'] as const,

    namingConventionPatterns: [
      String.raw`\bcamelCase\b`,
      String.raw`\bsnake_case\b`,
      String.raw`\bPascalCase\b`,
      String.raw`\bkebab-case\b`,
    ] as const,

    aggregationPatterns: [
      String.raw`\bmerge\s+(data|results|responses)\b`,
      String.raw`\bcombine\s+(data|results|responses|queries)\b`,
      String.raw`\bparallel\s+fetch`,
      String.raw`\bdual\s+path`,
      String.raw`\bfan[- ]?out\b`,
      String.raw`\bclient[- ]?side\s+(aggregat|merg|combin)`,
    ] as const,

    deferredCleanupPatterns: [
      String.raw`\bdefer(?:red)?\s+to\s+cleanup\b`,
      String.raw`\bhandle\s+in\s+cleanup\b`,
      String.raw`\bcleanup\s+prompt\s+will\b`,
    ] as const,

    filePathPattern:
      String.raw`(?:` +
      '`' +
      String.raw`([^` +
      '`' +
      String.raw`]*(?:src\/|\.\/|~\/|\.\.\/)[^` +
      '`' +
      String.raw`]*)` +
      '`' +
      String.raw`|(?:^|\s)((?:src\/|\.\/|~\/|\.\.\/)[a-zA-Z0-9_\-.\/]+))`,

    skillReferencePattern: String.raw`\/(?:build|refactor|audit|orchestrate|extract|flatten|migrate|replace|spawn|iterate|generate|sync|calibrate|visual|document)-[a-z]+(?:-[a-z]+)*`,

    // --- Interpreter ---
    severityMap: Object.freeze({
      // Hard blockers
      PROMPT_DEPENDENCY_CYCLE: 'blocker',
      PROMPT_FILE_MISSING: 'blocker',
      VERIFICATION_BLOCK_MISSING: 'blocker',
      // Warnings (subtract from score)
      PLAN_HEADER_MISSING: 'warning',
      PLAN_HEADER_INVALID: 'warning',
      PRE_FLIGHT_CONDITIONAL: 'warning',
      PRE_FLIGHT_BLOCKED: 'blocker',
      PRE_FLIGHT_MARK_MISSING: 'warning',
      CLEANUP_FILE_MISSING: 'warning',
      PROMPT_VERIFICATION_MISSING: 'warning',
      RECONCILIATION_TEMPLATE_MISSING: 'warning',
      PROMPT_MODE_UNSET: 'warning',
      STANDING_ELEMENT_MISSING: 'warning',
      CLIENT_SIDE_AGGREGATION: 'warning',
      // Informational (positive pre-flight)
      PRE_FLIGHT_CERTIFIED: 'info',
      NAMING_CONVENTION_INSTRUCTION: 'info',
      DEFERRED_CLEANUP_REFERENCE: 'info',
      FILE_PATH_REFERENCE: 'info',
      SKILL_REFERENCE: 'info',
      PROMPT_DEPENDENCY_EDGE_COUNT: 'info',
      PROMPT_CHAIN_DEPTH: 'info',
      PROMPT_FAN_OUT: 'info',
      PLAN_PROMPT_COUNT: 'info',
      PLAN_FILE_REFERENCE_DENSITY: 'info',
    } as Record<string, 'blocker' | 'warning' | 'info'>),

    checkWeights: Object.freeze({
      // Blockers still carry weight for the score (a blocked plan at 20 is worse than at 60)
      PROMPT_DEPENDENCY_CYCLE: 30,
      PROMPT_FILE_MISSING: 20,
      VERIFICATION_BLOCK_MISSING: 20,
      // Warning weights
      PLAN_HEADER_MISSING: 8,
      PLAN_HEADER_INVALID: 1,
      PRE_FLIGHT_CONDITIONAL: 8,
      PRE_FLIGHT_BLOCKED: 30,
      PRE_FLIGHT_MARK_MISSING: 10,
      CLEANUP_FILE_MISSING: 10,
      PROMPT_VERIFICATION_MISSING: 10,
      RECONCILIATION_TEMPLATE_MISSING: 5,
      PROMPT_MODE_UNSET: 5,
      STANDING_ELEMENT_MISSING: 3,
      CLIENT_SIDE_AGGREGATION: 5,
      // Info kinds have 0 weight
      PRE_FLIGHT_CERTIFIED: 0,
      NAMING_CONVENTION_INSTRUCTION: 0,
      DEFERRED_CLEANUP_REFERENCE: 0,
      FILE_PATH_REFERENCE: 0,
      SKILL_REFERENCE: 0,
      PROMPT_DEPENDENCY_EDGE_COUNT: 0,
      PROMPT_CHAIN_DEPTH: 0,
      PROMPT_FAN_OUT: 0,
      PLAN_PROMPT_COUNT: 0,
      PLAN_FILE_REFERENCE_DENSITY: 0,
      _default: 5,
    } as Record<string, number>),

    verdictThresholds: Object.freeze({
      certified: 90,
      conditional: 60,
    }),
  }),

  skillQuality: Object.freeze({
    requiredSections: Object.freeze({
      build: [
        { pattern: 'step\\s+\\d', label: 'Step headings' },
        { pattern: 'verif', label: 'Verify section' },
      ],
      refactor: [
        { pattern: 'prerequisite|step\\s+0', label: 'Prerequisite / Step 0' },
        { pattern: 'verif', label: 'Verify section' },
      ],
      audit: [{ pattern: 'step\\s+0', label: 'Step 0 (AST analysis)' }],
      orchestrate: [
        { pattern: 'step\\s+\\d', label: 'Step headings' },
        {
          pattern: 'final\\s+verification|verification\\s+checklist|pre-execution\\s+verification',
          label: 'Verification section',
        },
      ],
    } as Record<string, readonly { readonly pattern: string; readonly label: string }[]>),
    requiredRoles: Object.freeze({
      build: ['emit', 'workflow'],
      refactor: ['detect', 'emit', 'workflow'],
      audit: ['detect', 'workflow'],
      orchestrate: ['emit', 'workflow'],
    } as Record<string, readonly string[]>),
    deprecatedCommandPatterns: [
      { pattern: 'pnpm\\s+tsc\\s+--noEmit(?!\\s+-p)', replacement: 'pnpm tsc --noEmit -p tsconfig.check.json' },
      { pattern: 'pnpm\\s+build-types', replacement: 'pnpm tsc --noEmit -p tsconfig.check.json' },
    ] as { readonly pattern: string; readonly replacement: string }[],
  }),

  conventions: Object.freeze({
    rules: [
      {
        id: 'ch-query-registry',
        scope: 'clickhouse|ClickHouse|data-api.*handler|CH_QUERIES|queries\\.ts',
        current: ['CH_QUERIES', 'queries.types', '@/server/db/queries'],
        superseded: ['clickhouse\\.query\\(\\{[\\s\\S]*query:\\s*`', 'interface\\s+\\w+Row\\s*\\{'],
        message:
          'ClickHouse queries use the centralized registry (src/server/db/queries.ts) and row types (queries.types.ts), not inline SQL or hand-written row interfaces.',
      },
      {
        id: 'parse-input',
        scope: 'parseInput|req\\.body|req\\.query',
        current: ['parseInput'],
        superseded: ['\\w+Schema\\.parse\\(req\\.(?:body|query)\\)', '\\.parse\\(req\\.(?:body|query)\\)'],
        message:
          'BFF input validation uses parseInput(Schema, req.body) from @/server/errors/ApiErrorResponse, not bare Schema.parse(). parseInput converts ZodError into BadRequestError (400).',
      },
      {
        id: 'error-response-classes',
        scope: 'ApiErrorResponse|BadRequestError|NotFoundError|UnauthorizedError|ForbiddenError|res\\.status\\([45]',
        current: ['ApiErrorResponse', 'BadRequestError', 'NotFoundError', 'UnauthorizedError', 'ForbiddenError'],
        superseded: ['res\\.status\\([45]\\d{2}\\)\\.json\\('],
        message:
          'BFF error responses use error classes (BadRequestError, NotFoundError, etc.) from @/server/errors/, not inline res.status(4xx).json(). Error classes integrate with withErrorHandler middleware.',
      },
      {
        id: 'fetchapi-zod-schema',
        scope: 'fetchApi|FetchApiConfig|useFetchApi',
        current: ['fetchApi', 'FetchApiConfig'],
        superseded: ['(?:await\\s+)?fetch\\([\'"]\\/?api\\/'],
        message:
          'API calls use fetchApi() with a required Zod schema field, not bare fetch(). fetchApi handles auth headers, base URL, and runtime response validation.',
      },
      {
        id: 'typed-storage',
        scope: 'localStorage|sessionStorage|typedStorage|readStorage|writeStorage|removeStorage',
        current: ['typedStorage', 'readStorage', 'writeStorage', 'removeStorage'],
        superseded: ['localStorage\\.(?:get|set|remove)Item', 'sessionStorage\\.(?:get|set|remove)Item'],
        message:
          'Storage access uses readStorage/writeStorage/removeStorage from @/shared/utils/typedStorage with Zod schema validation, not direct localStorage/sessionStorage API calls.',
      },
      {
        id: 'env-validated',
        scope: 'process\\.env\\.(?!NEXT_PUBLIC_|NODE_ENV\\b)[A-Z_][A-Z_0-9]*|clientEnv|serverEnv',
        current: ['clientEnv', 'serverEnv'],
        superseded: ['process\\.env\\.(?!NEXT_PUBLIC_|NODE_ENV\\b)[A-Z_][A-Z_0-9]*'],
        message:
          'Environment variables are accessed through Zod-validated env modules (clientEnv, serverEnv), not raw process.env reads. The no-process-env ESLint rule enforces this.',
      },
      {
        id: 'branded-types',
        scope: 'as\\s+(?:User|Team|Workstream|Organization)Id\\b|UserId\\(|TeamId\\(|WorkstreamId\\(|OrganizationId\\(',
        current: ['UserId(', 'TeamId(', 'WorkstreamId(', 'OrganizationId('],
        superseded: ['as\\s+(?:User|Team|Workstream|Organization)Id\\b'],
        message:
          'Branded types use constructor functions (UserId(), TeamId(), etc.) or Zod .transform(BrandCtor), not type assertions (as UserId). See docs/type-schema-unification.md.',
      },
      {
        id: 'fixture-builders',
        scope: 'createMock\\w+|build\\(|buildMany\\(|@\\/fixtures|buildStandardScenario',
        current: ['build(', 'buildMany(', '@/fixtures', 'buildStandardScenario'],
        superseded: ['createMock\\w+'],
        message:
          'Test data uses the centralized fixture system (build/buildMany from src/fixtures/) with faker-backed builders and identity pool, not ad-hoc createMock* helpers.',
      },
    ] as const,
  }),

  bffGaps: Object.freeze({
    stubPatterns: ['status(501)'] as const,
    mockSegment: '/mock/',
  }),

  imports: Object.freeze({
    nextJsPagePrefix: 'src/pages/',
  }),

  truncation: Object.freeze({
    defaultMaxLength: 80,
    assertionMaxLength: 120,
    mockFactoryMaxLength: 200,
  }),

  authz: Object.freeze({
    canonicalFiles: new Set([
      'src/shared/utils/user/roleChecks.ts',
      'src/ui/components/8flow/RequireRoles.tsx',
      'src/ui/components/8flow/DevPanel/RolesSection.tsx',
      'src/server/middleware/withRole.ts',
      'src/server/lib/resolveRole.ts',
      'src/server/handlers/users/auth/roles.logic.ts',
      'src/server/handlers/users/user-data.logic.ts',
    ]) as ReadonlySet<string>,
    rawCheckMethods: new Set(['includes', 'indexOf', 'some', 'find', 'filter', 'every']) as ReadonlySet<string>,
    equalityOperators: new Set(['===', '!==']) as ReadonlySet<string>,
    singletonRoles: new Set(['TEAM_OWNER', 'MEMBER']) as ReadonlySet<string>,
  }),

  displayFormat: Object.freeze({
    /** The canonical placeholder constant name */
    placeholderConstant: 'NO_VALUE_PLACEHOLDER',
    /** The canonical placeholder value */
    placeholderValue: '-',
    /** Import path for the placeholder constant */
    placeholderImport: '@/shared/constants',
    /** Wrong placeholder strings to flag -- 'N/A' is included but interpreter marks it requiresManualReview since some usages are semantic "not applicable" */
    wrongPlaceholders: new Set(['N/A', '--', 'n/a', 'NA', 'None']) as ReadonlySet<string>,
    /** Standard formatting function names -- used to suppress RAW_TO_FIXED and RAW_TO_LOCALE_STRING inside formatter implementations */
    formatFunctions: new Set(['formatNumber', 'formatInt', 'formatDuration', 'formatCellValue']) as ReadonlySet<string>,
    /** Formatter file paths -- files exempt from HARDCODED_PLACEHOLDER (they define the '-' behavior) */
    formatterFilePaths: new Set([
      'src/shared/utils/number/formatNumber/formatNumber.ts',
      'src/shared/utils/number/formatInt/formatInt.ts',
      'src/shared/utils/time/formatDuration/formatDuration.ts',
      'src/shared/utils/table/formatCellValue/formatCellValue.ts',
    ]) as ReadonlySet<string>,
    /** Raw formatting methods that should go through shared formatters */
    rawFormatMethods: new Set(['toFixed', 'toLocaleString']) as ReadonlySet<string>,
    /** Empty state messages -- the canonical table empty message */
    canonicalEmptyMessage: 'There is no data',
    /** Wrong empty messages to flag */
    wrongEmptyMessages: new Set(['No data available', 'No data']) as ReadonlySet<string>,
    /** Placeholder string values that trigger NULL_COALESCE_FALLBACK (not all strings, just known placeholders) */
    placeholderStrings: new Set(['-', 'N/A', '--', 'n/a', 'NA', 'None']) as ReadonlySet<string>,
    /** Percentage context patterns (expected decimal precision per context) */
    percentagePrecision: Object.freeze({
      tableCell: 2,
      chartTooltip: 2,
      progressBar: 1,
      spaceConstrained: 0,
    }),
  }),

  behavioral: Object.freeze({
    jsxStringLiteralMinLength: 3,
    renderCapMethods: new Set(['slice', 'take', 'splice']) as ReadonlySet<string>,
    typeCoercionFunctions: new Set(['String', 'Number', 'Boolean', 'parseInt', 'parseFloat']) as ReadonlySet<string>,
    typeCoercionMethods: new Set(['toString', 'toFixed', 'valueOf']) as ReadonlySet<string>,
    stateInitHooks: new Set(['useState', 'useQueryState']) as ReadonlySet<string>,
    columnDefMethods: new Set(['accessor', 'display', 'group']) as ReadonlySet<string>,
    ignoredDefaultProps: new Set([
      'className',
      'style',
      'id',
      'key',
      'ref',
      'children',
      'as',
      'data-testid',
    ]) as ReadonlySet<string>,
  }),
}) satisfies AstConfig;

// ---------------------------------------------------------------------------
// Test analysis priority mapping
// ---------------------------------------------------------------------------

/**
 * Priority rules for authoritative test-analysis observations.
 * Consuming skills and agents use these to assign finding priority.
 */
export const TEST_ANALYSIS_PRIORITIES = Object.freeze({
  MOCK_INTERNAL_HIGH: 'P3',
  MOCK_INTERNAL_MEDIUM: 'P4',
  MISSING_CLEANUP: 'P4',
  DATA_SOURCING_VIOLATION: 'P5',
  IMPLEMENTATION_ASSERTION: 'P4',
} as const);

export type TestAnalysisPriorityKey = keyof typeof TEST_ANALYSIS_PRIORITIES;

// ---------------------------------------------------------------------------
// Centralized priority rules
// ---------------------------------------------------------------------------

export type FindingPriority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export interface PriorityRule {
  kind: string;
  condition: string;
  priority: FindingPriority;
}

/**
 * Declarative listing of every priority rule. The `condition` field is
 * documentation for human readers. The actual matching logic lives in
 * `lookupPriority` below.
 *
 * This table includes default/fallback rows so every code path in
 * `lookupPriority` has a corresponding entry. When adding a new rule,
 * add both the entry here and the matching branch in `lookupPriority`.
 */
export const PRIORITY_RULES: PriorityRule[] = [
  // P1
  { kind: 'bug', condition: 'authz OR crash OR CVE-critical', priority: 'P1' },
  { kind: 'complexity-hotspot', condition: 'CC >= 25', priority: 'P1' },
  // P2
  { kind: 'bug', condition: 'CVE-high', priority: 'P2' },
  { kind: 'bug', condition: 'default (no recognized subKind)', priority: 'P2' },
  { kind: 'test-gap', condition: 'risk === HIGH', priority: 'P2' },
  { kind: 'trust-boundary-gap', condition: 'always', priority: 'P2' },
  { kind: 'complexity-hotspot', condition: '15 <= CC < 25', priority: 'P2' },
  // P3
  { kind: 'test-gap', condition: 'risk === MEDIUM', priority: 'P3' },
  { kind: 'test-gap', condition: 'default (no recognized risk)', priority: 'P3' },
  { kind: 'complexity-hotspot', condition: 'CC < 15 (default)', priority: 'P3' },
  { kind: 'mock-internal', condition: 'confidence === high', priority: 'P3' },
  { kind: 'ddau-violation', condition: 'always', priority: 'P3' },
  { kind: 'eliminable-effect', condition: 'always', priority: 'P3' },
  { kind: 'cross-domain-coupling', condition: 'always', priority: 'P3' },
  // P4
  { kind: 'dead-export', condition: 'always', priority: 'P4' },
  { kind: 'as-any', condition: 'always', priority: 'P4' },
  { kind: 'non-null-assertion', condition: 'always', priority: 'P4' },
  { kind: 'test-gap', condition: 'risk === LOW', priority: 'P4' },
  { kind: 'mock-internal', condition: 'confidence < high (default)', priority: 'P4' },
  { kind: 'circular-dep', condition: 'not type-only (default)', priority: 'P4' },
  { kind: 'missing-concern', condition: 'always', priority: 'P4' },
  { kind: 'handler-inline-logic', condition: 'always', priority: 'P4' },
  { kind: 'branded-type-gap', condition: 'always', priority: 'P4' },
  // P5
  { kind: 'style', condition: 'always', priority: 'P5' },
  { kind: 'circular-dep', condition: 'type-only', priority: 'P5' },
];

const P1_BUG_SUB_KINDS = new Set(['authz', 'crash', 'CVE-critical']);
const P2_BUG_SUB_KINDS = new Set(['CVE-high']);

const CONFIDENCE_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/** Unconditional kind-to-priority mappings (no context needed). */
const UNCONDITIONAL_PRIORITY: Record<string, FindingPriority> = {
  'trust-boundary-gap': 'P2',
  'ddau-violation': 'P3',
  'eliminable-effect': 'P3',
  'cross-domain-coupling': 'P3',
  'dead-export': 'P4',
  'as-any': 'P4',
  'non-null-assertion': 'P4',
  'missing-concern': 'P4',
  'handler-inline-logic': 'P4',
  'branded-type-gap': 'P4',
  style: 'P5',
};

/**
 * Look up the priority for a finding by kind and optional context.
 *
 * Context keys used by specific rules:
 * - `cyclomaticComplexity` (number): for complexity-hotspot thresholds
 * - `risk` (string): 'HIGH' | 'MEDIUM' | 'LOW' for test-gap
 * - `confidence` (string): 'high' | 'medium' | 'low' for mock-internal
 * - `subKind` (string): for bug sub-classification (authz, crash, CVE-*)
 * - `isTypeOnly` (boolean): for circular-dep type-only check
 *
 * Returns P4 if no rule matches (safe default for unrecognized kinds).
 */
export function lookupPriority(kind: string, context?: Record<string, unknown>): FindingPriority {
  const cc = typeof context?.cyclomaticComplexity === 'number' ? context.cyclomaticComplexity : 0;
  const risk = typeof context?.risk === 'string' ? context.risk : '';
  const confidence = typeof context?.confidence === 'string' ? context.confidence : '';
  const subKind = typeof context?.subKind === 'string' ? context.subKind : '';
  const isTypeOnly = context?.isTypeOnly === true;

  // bug: P1 if authz/crash/CVE-critical, P2 if CVE-high
  if (kind === 'bug') {
    if (P1_BUG_SUB_KINDS.has(subKind)) return 'P1';
    if (P2_BUG_SUB_KINDS.has(subKind)) return 'P2';
    // Default bug with no recognized subKind gets P2 (conservative)
    return 'P2';
  }

  // complexity-hotspot: P1 if CC >= 25, P2 if CC >= 15
  if (kind === 'complexity-hotspot') {
    if (cc >= 25) return 'P1';
    if (cc >= 15) return 'P2';
    // Below threshold still gets P3 (notable but not urgent)
    return 'P3';
  }

  // test-gap: priority depends on risk level
  if (kind === 'test-gap') {
    if (risk === 'HIGH') return 'P2';
    if (risk === 'MEDIUM') return 'P3';
    if (risk === 'LOW') return 'P4';
    // Unknown risk level defaults to P3
    return 'P3';
  }

  // mock-internal: P3 if confidence >= high, P4 otherwise
  if (kind === 'mock-internal') {
    const confRank = CONFIDENCE_RANK[confidence] ?? 0;
    if (confRank >= CONFIDENCE_RANK['high']!) return 'P3';
    return 'P4';
  }

  // circular-dep: P5 if type-only, P4 otherwise
  if (kind === 'circular-dep') {
    if (isTypeOnly) return 'P5';
    return 'P4';
  }

  return UNCONDITIONAL_PRIORITY[kind] ?? 'P4';
}

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

  // The result structurally matches AstConfig (built by iterating all keys of
  // a valid AstConfig base), but Object.freeze erases the specific type to
  // Readonly<Record<string, unknown>>. The double assertion is the standard
  // TypeScript escape hatch for this pattern.
  return Object.freeze(result) as unknown as AstConfig;
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

// ---------------------------------------------------------------------------
// CLI entry point (--dump-priority-rules)
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--dump-priority-rules')) {
    const header = ['Kind', 'Condition', 'Priority'];
    const rows = PRIORITY_RULES.map(r => [r.kind, r.condition, r.priority]);
    const colWidths = header.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)));
    const fmt = (row: string[]) => '| ' + row.map((cell, i) => cell.padEnd(colWidths[i] ?? 0)).join(' | ') + ' |';

    process.stdout.write(fmt(header) + '\n');
    process.stdout.write('| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |\n');
    for (const row of rows) {
      process.stdout.write(fmt(row) + '\n');
    }
    process.exit(0);
  }

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-config.ts [--dump-priority-rules]\n' +
        '\n' +
        '  --dump-priority-rules  Print the PRIORITY_RULES table to stdout\n',
    );
    process.exit(0);
  }

  process.stderr.write('No action specified. Use --help for usage.\n');
  process.exit(1);
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-config.ts') || process.argv[1].endsWith('ast-config'));

if (isDirectRun) {
  main();
}

export type { AstConfig };
