/**
 * Hooks that are allowed in leaf components (not flagged as violations).
 * Canonical source of truth -- P02 (ast-react-inventory) reads this list
 * for hook classification. If the list changes, it changes here.
 */
export const MAY_REMAIN_HOOKS = [
  'useBreakpoints',
  'useWindowSize',
  'useDropdownScrollHandler',
  'useClickAway',
  'useScrollCallback',
  'usePagination',
  'useSorting',
  'useTheme',
  'useTranslation',
] as const;

/**
 * Pattern for scoped context hooks (useXxxScope).
 * Matched separately from the list above.
 */
export const SCOPED_HOOK_PATTERN = /^use\w+Scope$/;

/**
 * Known context hooks. Import path classification takes priority,
 * but these names are used as a fallback when import path is ambiguous.
 */
export const KNOWN_CONTEXT_HOOKS = [
  'useAuthState',
  'usePosthogContext',
  'useTeams',
  'useUsers',
  'useFlyoutContext',
  'useInsightsContext',
  'useBpoProjectContext',
] as const;

/**
 * Built-in React hooks classified as state-utility.
 */
export const REACT_BUILTIN_HOOKS = [
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
] as const;

// --- ast-imports output ---
export interface ImportInfo {
  source: string;
  specifiers: string[];
  isTypeOnly: boolean;
  line: number;
}

export interface ExportInfo {
  name: string;
  kind: 'function' | 'class' | 'type' | 'interface' | 'const' | 'enum' | 'default' | 'reexport';
  isTypeOnly: boolean;
  line: number;
}

export interface FileNode {
  path: string;
  relativePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
}

export interface DependencyGraph {
  files: FileNode[];
  edges: Array<{ from: string; to: string; specifiers: string[] }>;
  circularDeps: string[][];
  deadExports: Array<{ file: string; export: string; line: number }>;
}

// --- ast-react-inventory output ---
export interface HookCall {
  name: string;
  line: number;
  column: number;
  parentFunction: string;
  destructuredNames: string[];
  classification: 'service' | 'context' | 'dom-utility' | 'state-utility' | 'may-remain' | 'unknown';
}

export interface UseEffectInfo {
  line: number;
  parentFunction: string;
  depArray: string[] | 'none';
  hasCleanup: boolean;
  bodyAnalysis: {
    callsSetState: boolean;
    stateSetters: string[];
    callsFetch: boolean;
    callsNavigation: boolean;
    callsStorage: boolean;
    callsToast: boolean;
    hasTimers: boolean;
  };
}

export interface PropField {
  name: string;
  type: string;
  optional: boolean;
  hasDefault: boolean;
  isCallback: boolean;
}

export interface ComponentInfo {
  name: string;
  line: number;
  kind: 'function' | 'arrow' | 'memo' | 'forwardRef';
  props: PropField[];
  hookCalls: HookCall[];
  useEffects: UseEffectInfo[];
  returnStatementLine: number;
  returnStatementEndLine: number;
}

export interface ReactInventory {
  filePath: string;
  components: ComponentInfo[];
  hookDefinitions: string[];
}

// --- ast-jsx-analysis output ---
export type JsxViolationType =
  | 'CHAINED_TERNARY'
  | 'COMPLEX_GUARD'
  | 'INLINE_TRANSFORM'
  | 'IIFE_IN_JSX'
  | 'MULTI_STMT_HANDLER'
  | 'INLINE_STYLE_OBJECT'
  | 'COMPLEX_CLASSNAME';

export interface JsxViolation {
  type: JsxViolationType;
  line: number;
  column: number;
  description: string;
  parentComponent: string;
}

export interface JsxAnalysis {
  filePath: string;
  components: Array<{
    name: string;
    returnStartLine: number;
    returnEndLine: number;
    returnLineCount: number;
    violations: JsxViolation[];
  }>;
}

// --- ast-type-safety output ---
export type TypeSafetyViolationType =
  | 'AS_ANY'
  | 'AS_UNKNOWN_AS'
  | 'NON_NULL_ASSERTION'
  | 'EXPLICIT_ANY_ANNOTATION'
  | 'CATCH_ERROR_ANY'
  | 'TS_DIRECTIVE_NO_COMMENT'
  | 'TRUST_BOUNDARY_CAST';

export interface TypeSafetyViolation {
  type: TypeSafetyViolationType;
  line: number;
  column: number;
  text: string;
  context: string;
}

export interface TypeSafetyAnalysis {
  filePath: string;
  violations: TypeSafetyViolation[];
  summary: Record<TypeSafetyViolationType, number>;
}

// --- ast-test-analysis output ---
export type MockClassification =
  | 'BOUNDARY'
  | 'OWN_HOOK'
  | 'OWN_COMPONENT'
  | 'OWN_UTILITY'
  | 'THIRD_PARTY'
  | 'DOMAIN_BOUNDARY';

export interface MockInfo {
  target: string;
  resolvedPath: string;
  classification: MockClassification;
  line: number;
  returnShape: string;
}

export type AssertionClassification =
  | 'USER_VISIBLE'
  | 'CALLBACK_FIRED'
  | 'HOOK_RETURN'
  | 'IMPLEMENTATION_DETAIL'
  | 'LARGE_SNAPSHOT';

export interface AssertionInfo {
  line: number;
  classification: AssertionClassification;
  text: string;
}

export type TestStrategy =
  | 'unit-pure'
  | 'unit-props'
  | 'integration-providers'
  | 'integration-msw'
  | 'playwright'
  | 'mixed';

export interface TestAnalysis {
  filePath: string;
  subjectPath: string;
  subjectExists: boolean;
  isOrphaned: boolean;
  strategy: TestStrategy;
  describeCount: number;
  testCount: number;
  mocks: MockInfo[];
  assertions: AssertionInfo[];
  cleanup: {
    hasAfterEach: boolean;
    restoresMocks: boolean;
    restoresTimers: boolean;
    clearsStorage: boolean;
  };
  dataSourcing: {
    usesFixtureSystem: boolean;
    usesSharedMutableConstants: boolean;
    asAnyCount: number;
  };
}

// --- ast-complexity output ---
export interface FunctionComplexity {
  name: string;
  line: number;
  endLine: number;
  lineCount: number;
  cyclomaticComplexity: number;
  maxNestingDepth: number;
  contributors: Array<{
    type:
      | 'if'
      | 'else-if'
      | 'switch-case'
      | 'ternary'
      | 'logical-and'
      | 'logical-or'
      | 'nullish-coalesce'
      | 'catch'
      | 'loop'
      | 'optional-chain';
    line: number;
  }>;
}

export interface ComplexityAnalysis {
  filePath: string;
  functions: FunctionComplexity[];
  fileTotalComplexity: number;
}

// --- ast-side-effects output ---
export type SideEffectType = 'CONSOLE_CALL' | 'TOAST_CALL' | 'TIMER_CALL' | 'POSTHOG_CALL' | 'WINDOW_MUTATION';

export interface SideEffectInstance {
  type: SideEffectType;
  line: number;
  column: number;
  text: string;
  containingFunction: string;
  isInsideUseEffect: boolean;
}

export interface SideEffectsAnalysis {
  filePath: string;
  sideEffects: SideEffectInstance[];
  summary: Record<SideEffectType, number>;
}

// --- ast-storage-access output ---
export type StorageAccessType =
  | 'DIRECT_LOCAL_STORAGE'
  | 'DIRECT_SESSION_STORAGE'
  | 'TYPED_STORAGE_READ'
  | 'TYPED_STORAGE_WRITE'
  | 'TYPED_STORAGE_REMOVE'
  | 'JSON_PARSE_UNVALIDATED'
  | 'COOKIE_ACCESS';

export interface StorageAccessInstance {
  type: StorageAccessType;
  line: number;
  column: number;
  text: string;
  containingFunction: string;
  isViolation: boolean;
}

export interface StorageAccessAnalysis {
  filePath: string;
  accesses: StorageAccessInstance[];
  summary: Record<StorageAccessType, number>;
  violationCount: number;
  compliantCount: number;
}

// --- ast-env-access output ---
export type EnvAccessType =
  | 'DIRECT_PROCESS_ENV'
  | 'CLIENT_ENV_ACCESS'
  | 'SERVER_ENV_ACCESS'
  | 'CLIENT_ENV_IMPORT'
  | 'SERVER_ENV_IMPORT'
  | 'RAW_ENV_IMPORT';

export interface EnvAccessInstance {
  type: EnvAccessType;
  line: number;
  column: number;
  text: string;
  propertyName: string | null;
  containingFunction: string;
  isViolation: boolean;
  isTreeShakingGuard: boolean;
}

export interface EnvAccessAnalysis {
  filePath: string;
  accesses: EnvAccessInstance[];
  summary: Record<EnvAccessType, number>;
  violationCount: number;
  compliantCount: number;
}

// --- ast-feature-flags output ---
export type FeatureFlagUsageType =
  | 'FLAG_HOOK_CALL'
  | 'FLAG_READ'
  | 'PAGE_GUARD'
  | 'NAV_TAB_GATE'
  | 'CONDITIONAL_RENDER'
  | 'FLAG_OVERRIDE';

export interface FeatureFlagUsage {
  type: FeatureFlagUsageType;
  line: number;
  column: number;
  flagName: string | null;
  containingFunction: string;
  text: string;
}

export interface FeatureFlagAnalysis {
  filePath: string;
  usages: FeatureFlagUsage[];
  flagsReferenced: string[];
  summary: Record<FeatureFlagUsageType, number>;
}

// --- ast-data-layer output ---
export type DataLayerUsageType =
  | 'QUERY_HOOK_DEF'
  | 'MUTATION_HOOK_DEF'
  | 'QUERY_KEY_DEF'
  | 'FETCH_API_CALL'
  | 'API_ENDPOINT'
  | 'QUERY_INVALIDATION';

export interface DataLayerDetails {
  queryKey?: string;
  url?: string;
  schema?: string;
  keys?: string;
}

export interface DataLayerUsage {
  type: DataLayerUsageType;
  line: number;
  column: number;
  name: string;
  text: string;
  containingFunction: string;
  details: DataLayerDetails;
}

export interface DataLayerAnalysis {
  filePath: string;
  usages: DataLayerUsage[];
  summary: Record<DataLayerUsageType, number>;
}
