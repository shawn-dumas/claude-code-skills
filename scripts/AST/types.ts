// --- ast-imports output ---
export interface ImportInfo {
  source: string;
  specifiers: string[];
  isTypeOnly: boolean;
  line: number;
  /** Absolute path to the resolved module. Populated by buildDependencyGraph's eager resolution pass. */
  resolvedPath?: string;
}

export interface ExportInfo {
  name: string;
  kind: 'function' | 'class' | 'type' | 'interface' | 'const' | 'enum' | 'default' | 'reexport';
  isTypeOnly: boolean;
  line: number;
  /** True when this export originates from a re-export declaration (export { X } from './y' or export * from './y'). */
  isReexport?: boolean;
}

export interface FileNode {
  path: string;
  relativePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  /** PascalCase JSX element names rendered in this file (excludes intrinsic elements like div, span). */
  jsxElementNames?: string[];
}

export interface DependencyGraph {
  files: FileNode[];
  edges: { from: string; to: string; specifiers: string[] }[];
  circularDeps: string[][];
  deadExports: { file: string; export: string; line: number }[];
}

// --- ast-react-inventory output ---
export interface HookCall {
  name: string;
  line: number;
  column: number;
  parentFunction: string;
  destructuredNames: string[];
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
  /**
   * Function shape. `hook` covers pure-TS custom hooks (name starts with
   * `use`, no JSX return) -- they are enumerated so `useEffect` /
   * `useMemo` / `useCallback` / `useLayoutEffect` inside their bodies
   * is visible to inventory callers. Callers that only care about
   * components should filter by `kind !== 'hook'`.
   */
  kind: 'function' | 'arrow' | 'memo' | 'forwardRef' | 'hook';
  props: PropField[];
  hookCalls: HookCall[];
  useEffects: UseEffectInfo[];
  effectObservations: EffectObservation[];
  returnStatementLine: number;
  returnStatementEndLine: number;
}

export interface ReactInventory {
  filePath: string;
  components: ComponentInfo[];
  hookDefinitions: string[];
  hookObservations: HookObservation[];
  componentObservations: ComponentObservation[];
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
  components: {
    name: string;
    returnStartLine: number;
    returnEndLine: number;
    returnLineCount: number;
    violations: JsxViolation[];
  }[];
  observations: JsxObservation[];
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
  observations: TypeSafetyObservation[];
}

// --- ast-test-analysis output ---
export interface MockInfo {
  target: string;
  resolvedPath: string;
  line: number;
  returnShape: string;
}

export interface AssertionInfo {
  line: number;
  text: string;
}

export interface TestAnalysis {
  filePath: string;
  subjectPath: string;
  subjectExists: boolean;
  isOrphaned: boolean;
  describeCount: number;
  testCount: number;
  /** Test count after expanding .each and factory patterns. Equals testCount when no factories exist. */
  expandedTestCount: number;
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
  observations: TestObservation[];
}

// --- ast-complexity output ---
export interface FunctionComplexity {
  name: string;
  line: number;
  endLine: number;
  lineCount: number;
  cyclomaticComplexity: number;
  maxNestingDepth: number;
  contributors: {
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
  }[];
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
  observations: SideEffectObservation[];
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
  observations: StorageObservation[];
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
  observations: EnvObservation[];
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
  observations: FeatureFlagObservation[];
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
  resolvedKeys?: Record<string, string>;
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

// ============================================================
// Semantic Layering Types (Observation / Assessment)
// ============================================================

/**
 * Base type for all AST tool observations.
 * An observation is a line-anchored structural fact extracted from
 * source code. It never contains classifications or judgments.
 */
export type Observation<K extends string = string, E extends Record<string, unknown> = Record<string, unknown>> = {
  readonly kind: K;
  readonly file: string;
  readonly line: number;
  readonly column?: number;
  readonly evidence: E;
};

/**
 * Reference to an observation, used by assessments to trace
 * their basis.
 */
export type ObservationRef = {
  readonly kind: string;
  readonly file: string;
  readonly line: number;
};

/**
 * Base type for all interpreter assessments.
 * An assessment is an interpretation over observations plus repo config.
 * It always carries confidence and rationale.
 */
export type Assessment<K extends string = string> = {
  readonly kind: K;
  readonly subject: {
    readonly file: string;
    readonly line?: number;
    readonly symbol?: string;
  };
  readonly confidence: 'high' | 'medium' | 'low';
  readonly rationale: readonly string[];
  readonly basedOn: readonly ObservationRef[];
  readonly isCandidate: boolean;
  readonly requiresManualReview: boolean;
};

// --- Effect observations (ast-react-inventory useEffect section) ---

export type EffectObservationKind =
  | 'EFFECT_LOCATION'
  | 'EFFECT_DEP_ENTRY'
  | 'EFFECT_STATE_SETTER_CALL'
  | 'EFFECT_FETCH_CALL'
  | 'EFFECT_TIMER_CALL'
  | 'EFFECT_NAVIGATION_CALL'
  | 'EFFECT_STORAGE_CALL'
  | 'EFFECT_TOAST_CALL'
  | 'EFFECT_CLEANUP_PRESENT'
  | 'EFFECT_ASYNC_CALL'
  | 'EFFECT_PROP_READ'
  | 'EFFECT_CONTEXT_READ'
  | 'EFFECT_REF_TOUCH'
  | 'EFFECT_DOM_API'
  | 'EFFECT_BODY_DEP_CALL';

export type EffectObservationEvidence = {
  effectLine: number;
  parentFunction?: string;
  depArray?: string[];
  identifier?: string;
  targetObject?: string;
  method?: string;
  /** True when the ref's generic type parameter extends HTMLElement/SVGElement/Element. */
  isDomRef?: boolean;
};

export type EffectObservation = Observation<EffectObservationKind, EffectObservationEvidence>;

// --- Branch classification assessments (ast-interpret-branch-classification) ---

export type BranchClassificationKind =
  | 'TYPE_DISPATCH'
  | 'NULL_GUARD'
  | 'ERROR_CHECK'
  | 'FEATURE_FLAG'
  | 'BOOLEAN_GUARD'
  | 'LOADING_CHECK'
  | 'OTHER';

export type BranchClassificationEvidence = {
  functionName: string;
  contributorType: string;
  contributorLine: number;
  conditionText: string;
  dispatchTarget?: string;
  guardTarget?: string;
  flagName?: string;
};

export type BranchClassificationAssessment = Assessment<BranchClassificationKind> & {
  readonly evidence: BranchClassificationEvidence;
};

// --- Effect assessments (ast-interpret-effects) ---

export type EffectAssessmentKind =
  | 'DERIVED_STATE'
  | 'EVENT_HANDLER_DISGUISED'
  | 'TIMER_RACE'
  | 'DOM_EFFECT'
  | 'EXTERNAL_SUBSCRIPTION'
  | 'NECESSARY';

export type EffectAssessment = Assessment<EffectAssessmentKind>;

// --- Hook assessments (ast-interpret-hooks) ---

export type HookAssessmentKind =
  | 'LIKELY_SERVICE_HOOK'
  | 'LIKELY_CONTEXT_HOOK'
  | 'LIKELY_AMBIENT_HOOK'
  | 'LIKELY_STATE_HOOK'
  | 'UNKNOWN_HOOK';

export type HookAssessment = Assessment<HookAssessmentKind>;

// --- Ownership assessments (ast-interpret-ownership) ---

export type OwnershipAssessmentKind = 'CONTAINER' | 'DDAU_COMPONENT' | 'LAYOUT_SHELL' | 'LEAF_VIOLATION' | 'AMBIGUOUS';

export type OwnershipAssessment = Assessment<OwnershipAssessmentKind>;

// --- Template assessments (ast-interpret-template) ---

export type TemplateAssessmentKind =
  | 'EXTRACTION_CANDIDATE' // pattern should become a shared component
  | 'COMPLEXITY_HOTSPOT'; // return block is too complex, needs flattening

export type TemplateAssessment = Assessment<TemplateAssessmentKind>;

// --- Dead code assessments (ast-interpret-dead-code) ---

export type DeadCodeAssessmentKind =
  | 'DEAD_EXPORT' // export with 0 consumers, high confidence
  | 'POSSIBLY_DEAD_EXPORT' // export with 0 static consumers but may be dynamic
  | 'DEAD_BARREL_REEXPORT' // barrel re-exports something nobody imports
  | 'CIRCULAR_DEPENDENCY'; // part of a circular import chain

export type DeadCodeAssessment = Assessment<DeadCodeAssessmentKind>;

// --- Test quality assessments (ast-interpret-test-quality) ---

export type TestQualityAssessmentKind =
  | 'MOCK_BOUNDARY_COMPLIANT' // mock targets only external boundaries
  | 'MOCK_INTERNAL_VIOLATION' // mocks own hook/component/utility
  | 'MOCK_DOMAIN_BOUNDARY' // mocks hook from different domain (review)
  | 'ASSERTION_USER_VISIBLE' // asserts on rendered output / aria
  | 'ASSERTION_IMPLEMENTATION' // asserts on implementation details
  | 'ASSERTION_SNAPSHOT' // large snapshot assertion
  | 'DETECTED_STRATEGY' // neutral record of what test strategy was detected
  | 'CLEANUP_COMPLETE' // proper afterEach + restore
  | 'CLEANUP_INCOMPLETE' // missing cleanup patterns
  | 'DATA_SOURCING_COMPLIANT' // uses fixture system
  | 'DATA_SOURCING_VIOLATION' // shared mutable constants or as any
  | 'ORPHANED_TEST' // subject file does not exist
  | 'DELETE_CANDIDATE'; // triage heuristic: high internal-mock count, not a quality score

export type TestQualityAssessment = Assessment<TestQualityAssessmentKind>;

// --- Test helper index (ast-interpret-test-quality helper resolution) ---

/** Per-function assertion summary from a Vitest test helper file. */
export interface TestHelperEntry {
  functionName: string;
  file: string;
  line: number;
  assertionCount: number;
  userVisibleCount: number;
  implementationCount: number;
}

/** Index of all helper functions resolved from TEST_HELPER_DELEGATION observations. */
export interface TestHelperIndex {
  entries: Map<string, TestHelperEntry>;
}

/**
 * Standard return shape for observation-producing tools.
 */
export type ObservationResult<O extends Observation = Observation> = {
  readonly filePath: string;
  readonly observations: readonly O[];
};

/**
 * Standard return shape for interpreters.
 */
export type AssessmentResult<A extends Assessment = Assessment> = {
  readonly assessments: readonly A[];
};

// --- Storage observations ---
export type StorageObservationKind =
  | 'DIRECT_STORAGE_CALL' // localStorage.getItem, sessionStorage.setItem, etc.
  | 'TYPED_STORAGE_CALL' // readStorage, writeStorage, removeStorage
  | 'JSON_PARSE_CALL' // JSON.parse without Zod guard
  | 'JSON_PARSE_ZOD_GUARDED' // JSON.parse wrapped in .parse()/.safeParse()
  | 'COOKIE_CALL' // Cookies.get, Cookies.set, etc.
  | 'STORAGE_PROPERTY_ACCESS'; // localStorage.length, sessionStorage (bare reference)

export type StorageObservationEvidence = {
  storageType?: 'localStorage' | 'sessionStorage';
  method?: string;
  helperName?: string;
  isZodGuarded?: boolean;
};

export type StorageObservation = Observation<StorageObservationKind, StorageObservationEvidence>;

// --- Env observations ---
export type EnvObservationKind =
  | 'PROCESS_ENV_ACCESS' // process.env.FOO
  | 'ENV_WRAPPER_ACCESS' // clientEnv.FOO, serverEnv.BAR
  | 'ENV_WRAPPER_IMPORT' // import { clientEnv } from '...'
  | 'RAW_ENV_IMPORT'; // const env = process.env

export type EnvObservationEvidence = {
  propertyName?: string;
  wrapperName?: string;
  moduleSpecifier?: string;
  hasTreeShakingComment?: boolean;
};

export type EnvObservation = Observation<EnvObservationKind, EnvObservationEvidence>;

// --- Side effect observations ---
export type SideEffectObservationKind =
  | 'CONSOLE_CALL'
  | 'TOAST_CALL'
  | 'TIMER_CALL'
  | 'POSTHOG_CALL'
  | 'WINDOW_MUTATION';

export type SideEffectObservationEvidence = {
  object?: string; // 'console', 'toast', 'posthog', 'window', 'history'
  method?: string; // 'log', 'warn', 'capture', 'pushState', etc.
  containingFunction?: string;
  isInsideUseEffect?: boolean;
};

export type SideEffectObservation = Observation<SideEffectObservationKind, SideEffectObservationEvidence>;

// --- Feature flag observations ---
export type FeatureFlagObservationKind =
  | 'FLAG_HOOK_CALL'
  | 'FLAG_READ'
  | 'PAGE_GUARD'
  | 'NAV_TAB_GATE'
  | 'CONDITIONAL_RENDER'
  | 'FLAG_OVERRIDE';

export type FeatureFlagObservationEvidence = {
  hookName?: string;
  flagName?: string;
  containingFunction?: string;
  destructuredBindings?: string[];
};

export type FeatureFlagObservation = Observation<FeatureFlagObservationKind, FeatureFlagObservationEvidence>;

// --- Type safety observations ---
export type TypeSafetyObservationKind =
  | 'AS_ANY_CAST' // x as any
  | 'AS_UNKNOWN_AS_CAST' // x as unknown as T
  | 'NON_NULL_ASSERTION' // x!
  | 'EXPLICIT_ANY_ANNOTATION' // param: any, let x: any
  | 'CATCH_ERROR_ANY' // catch(e: any) or catch(e) { e as any }
  | 'TS_DIRECTIVE' // ts-expect-error, ts-ignore
  | 'ESLINT_DISABLE' // eslint-disable without reason
  | 'TRUST_BOUNDARY_CAST'; // JSON.parse(...) as T (without Zod)

export type TypeSafetyObservationEvidence = {
  text?: string;
  castTarget?: string; // the type being cast to
  sourceExpression?: string; // what is being cast
  hasGuard?: boolean; // for non-null assertions: preceding guard detected
  guardType?: 'if-check' | 'has-check' | 'null-check'; // type of guard
  directiveText?: string; // for TS directives: the full comment text
  hasExplanation?: boolean; // for directives: does it have explanatory text
  trustBoundarySource?: 'JSON.parse' | '.json()' | 'localStorage' | 'sessionStorage' | 'process.env';
  isInsideComplexType?: boolean; // inside ConditionalType, MappedType, etc.
  hasJustification?: boolean; // for AS_UNKNOWN_AS_CAST: preceding comment explains intent
};

export type TypeSafetyObservation = Observation<TypeSafetyObservationKind, TypeSafetyObservationEvidence>;

// --- Import/export observations ---
export type ImportObservationKind =
  | 'STATIC_IMPORT'
  | 'DYNAMIC_IMPORT'
  | 'REEXPORT_IMPORT'
  | 'SIDE_EFFECT_IMPORT'
  | 'EXPORT_DECLARATION'
  | 'CIRCULAR_DEPENDENCY'
  | 'DEAD_EXPORT_CANDIDATE';

export type ImportObservationEvidence = {
  source?: string;
  specifiers?: string[];
  isTypeOnly?: boolean;
  exportName?: string;
  exportKind?: string;
  cyclePath?: string[];
  consumerCount?: number;
  isBarrelReexported?: boolean;
  isNextJsPage?: boolean;
};

export type ImportObservation = Observation<ImportObservationKind, ImportObservationEvidence>;

// --- Complexity observations ---
export type ComplexityObservationKind = 'FUNCTION_COMPLEXITY';

export type ComplexityObservationEvidence = {
  functionName: string;
  endLine: number;
  lineCount: number;
  cyclomaticComplexity: number;
  maxNestingDepth: number;
  contributors: { type: string; line: number }[];
};

export type ComplexityObservation = Observation<ComplexityObservationKind, ComplexityObservationEvidence>;

// --- Data layer observations ---
export type DataLayerObservationKind =
  | 'QUERY_HOOK_DEFINITION'
  | 'MUTATION_HOOK_DEFINITION'
  | 'QUERY_KEY_FACTORY'
  | 'FETCH_API_CALL'
  | 'API_ENDPOINT'
  | 'QUERY_INVALIDATION';

export type DataLayerObservationEvidence = {
  name?: string;
  queryKey?: string[];
  url?: string;
  schema?: string;
  keys?: string[];
  containingFunction?: string;
  resolvedKeys?: Record<string, string>;
};

export type DataLayerObservation = Observation<DataLayerObservationKind, DataLayerObservationEvidence>;

// --- Hook observations ---
export type HookObservationKind =
  | 'HOOK_CALL' // any use* call
  | 'HOOK_IMPORT' // import of a hook from a specific path
  | 'HOOK_DEFINITION'; // function definition of a custom hook

export type HookObservationEvidence = {
  hookName: string;
  importSource?: string; // resolved import path
  destructuredNames?: string[]; // const { data, isLoading } = useQuery()
  parentFunction?: string; // enclosing component/hook name
  isReactBuiltin?: boolean; // true for useState, useRef, etc.
  isMemberCall?: boolean; // true when called as obj.useHook() (DI via props)
  // For HOOK_DEFINITION:
  definesHooks?: string[]; // hooks called inside this hook definition
  returnsIdentifier?: string; // callee name of the return expression
};

export type HookObservation = Observation<HookObservationKind, HookObservationEvidence>;

// --- Component observations ---
export type ComponentObservationKind = 'COMPONENT_DECLARATION' | 'PROP_FIELD';

export type ComponentObservationEvidence = {
  componentName?: string;
  kind?: 'function' | 'arrow' | 'memo' | 'forwardRef';
  // For PROP_FIELD:
  propName?: string;
  propType?: string;
  isOptional?: boolean;
  hasDefault?: boolean;
  isCallback?: boolean; // type contains => or name starts with on[A-Z]
};

export type ComponentObservation = Observation<ComponentObservationKind, ComponentObservationEvidence>;

// --- JSX observations ---
export type JsxObservationKind =
  | 'JSX_TERNARY_CHAIN'
  | 'JSX_GUARD_CHAIN'
  | 'JSX_TRANSFORM_CHAIN'
  | 'JSX_IIFE'
  | 'JSX_INLINE_HANDLER'
  | 'JSX_INLINE_STYLE'
  | 'JSX_COMPLEX_CLASSNAME'
  | 'JSX_RETURN_BLOCK';

export type JsxObservationEvidence = {
  componentName: string;
  // For TERNARY_CHAIN:
  depth?: number; // actual nesting depth
  // For GUARD_CHAIN:
  conditionCount?: number; // number of && conditions
  // For TRANSFORM_CHAIN:
  methods?: string[]; // ['filter', 'map']
  chainLength?: number;
  // For INLINE_HANDLER:
  handlerName?: string; // 'onClick', 'onChange'
  statementCount?: number;
  // For INLINE_STYLE:
  hasComputedValues?: boolean;
  // For COMPLEX_CLASSNAME:
  ternaryCount?: number;
  // For RETURN_BLOCK:
  returnStartLine?: number;
  returnEndLine?: number;
  returnLineCount?: number;
  description?: string; // truncated text
};

export type JsxObservation = Observation<JsxObservationKind, JsxObservationEvidence>;

// --- Test observations ---
export type TestObservationKind =
  | 'TEST_SUBJECT_IMPORT' // import of the module under test
  | 'TEST_HELPER_IMPORT' // import from test helpers / testing-library
  | 'MOCK_DECLARATION' // vi.mock() call
  | 'SPY_DECLARATION' // vi.spyOn() call
  | 'MOCK_TARGET_RESOLVED' // resolved file path of a mock target
  | 'ASSERTION_CALL' // expect().toX() call
  | 'RENDER_CALL' // render() or renderHook() call
  | 'PROVIDER_WRAPPER' // QueryClientProvider, AuthProvider, etc.
  | 'AFTER_EACH_BLOCK' // afterEach() call
  | 'CLEANUP_CALL' // restoreAllMocks, clearStorage, etc.
  | 'FIXTURE_IMPORT' // import from fixtures
  | 'SHARED_MUTABLE_IMPORT' // import from shared test constants
  | 'DESCRIBE_BLOCK' // describe() call
  | 'TEST_BLOCK' // it() or test() call
  | 'PLAYWRIGHT_IMPORT' // import from @playwright/test or fixture
  | 'TEST_HELPER_DELEGATION' // call to a helper function that may contain assertions
  | 'SEQUENTIAL_MOCK_RESPONSE' // 3+ sequential mockResponseOnce calls (fragile ordering)
  | 'TIMER_NEGATIVE_ASSERTION' // setTimeout used before negative assertion (non-deterministic)
  | 'MOCK_INTERNAL' // vi.mock() targeting a project-internal module (authoritative)
  | 'MISSING_CLEANUP' // file has mocks or timers but no afterEach cleanup (authoritative)
  | 'DATA_SOURCING_VIOLATION' // as-any casts or shared mutable imports in test (authoritative)
  | 'IMPLEMENTATION_ASSERTION'; // asserts on hook/mutation call args instead of rendered output (authoritative)

export type TestObservationEvidence = {
  // For MOCK_DECLARATION:
  target?: string; // the module being mocked
  resolvedPath?: string; // resolved file path
  returnShapeText?: string; // factory text
  // For MOCK_TARGET_RESOLVED:
  exportNames?: string[]; // named exports from the resolved file
  fileExtension?: string; // .ts, .tsx -- lets interpreter infer component vs module
  // For ASSERTION_CALL:
  matcherName?: string; // 'toBeVisible', 'toHaveBeenCalled', etc.
  expectArgText?: string; // what is being asserted on
  isScreenQuery?: boolean; // expect(screen.getBy...)
  isResultCurrent?: boolean; // expect(result.current)
  // For RENDER_CALL:
  isRenderHook?: boolean;
  hasWrapper?: boolean;
  // For PROVIDER_WRAPPER:
  providerName?: string;
  // For CLEANUP_CALL:
  cleanupType?: string; // 'restoreAllMocks', 'clearStorage', etc.
  // For FIXTURE_IMPORT:
  fixtureSource?: string;
  // For TEST_BLOCK:
  testName?: string;
  // For DESCRIBE_BLOCK:
  describeName?: string;
  // For SPY_DECLARATION:
  spyTarget?: string;
  spyMethod?: string;
  // For TEST_SUBJECT_IMPORT / TEST_HELPER_IMPORT:
  importSource?: string;
  specifiers?: string[];
  // For TEST_HELPER_DELEGATION:
  delegationType?: 'helper';
  functionName?: string;
  argCount?: number;
  isImported?: boolean;
  sourceFile?: string;
  // For TEST_BLOCK (factory expansion):
  isExpanded?: boolean; // true when test count comes from .each expansion
  expandedCount?: number; // number of test cases in .each array
  // For SEQUENTIAL_MOCK_RESPONSE:
  sequentialCount?: number; // number of consecutive mockResponseOnce calls
  // For TIMER_NEGATIVE_ASSERTION:
  delayMs?: number; // the delay value in setTimeout
  // For MOCK_INTERNAL:
  confidence?: 'high' | 'medium'; // high when resolved, medium when path-heuristic only
  // For MISSING_CLEANUP:
  hasMocks?: boolean;
  hasTimers?: boolean;
  // For DATA_SOURCING_VIOLATION:
  asAnyCount?: number;
  hasSharedMutable?: boolean;
  // For IMPLEMENTATION_ASSERTION:
  hookName?: string; // the hook or mutation identifier being asserted on
  assertionType?: 'hook-call-args' | 'mutation-call-args'; // category of implementation assertion
  pattern?: string; // the matched code text
};

export type TestObservation = Observation<TestObservationKind, TestObservationEvidence> & {
  readonly authoritative?: boolean;
};

// --- ast-pw-test-parity output (Playwright spec inventory) ---

export interface PwAssertionDetail {
  line: number;
  matcher: string;
  target: string;
}

export interface PwRouteIntercept {
  line: number;
  urlPattern: string;
}

export interface PwHelperDelegation {
  line: number;
  functionName: string;
  argCount: number;
}

export interface PwTestBlock {
  name: string;
  line: number;
  describeParent: string | null;
  assertionCount: number;
  assertions: PwAssertionDetail[];
  routeIntercepts: PwRouteIntercept[];
  navigations: string[];
  pomUsages: string[];
  helperDelegations: PwHelperDelegation[];
  isSkipped?: boolean;
}

/** Per-function/method assertion count from a helper or POM file. */
export interface PwHelperEntry {
  /** ClassName.methodName or standalone functionName */
  qualifiedName: string;
  assertionCount: number;
  filePath: string;
  line: number;
}

/** Index of all helper functions across parsed helper files. */
export interface PwHelperIndex {
  entries: PwHelperEntry[];
  /** Map from qualifiedName -> assertionCount for fast lookup */
  lookup: Record<string, number>;
}

export interface PwSpecInventory {
  filePath: string;
  describes: string[];
  tests: PwTestBlock[];
  totalAssertions: number;
  totalRouteIntercepts: number;
  beforeEachPresent: boolean;
  serialMode: boolean;
  authMethod: string | null;
}

// --- ast-pw-test-parity observations ---

export type PwParityObservationKind =
  | 'PW_TEST_BLOCK'
  | 'PW_ASSERTION'
  | 'PW_ROUTE_INTERCEPT'
  | 'PW_NAVIGATION'
  | 'PW_POM_USAGE'
  | 'PW_AUTH_CALL'
  | 'PW_SERIAL_MODE'
  | 'PW_BEFORE_EACH'
  | 'PW_HELPER_DELEGATION';

export type PwParityObservationEvidence = {
  // PW_TEST_BLOCK
  testName?: string;
  describeName?: string | null;
  assertionCount?: number;
  routeInterceptCount?: number;
  navigationCount?: number;
  pomCount?: number;
  helperDelegationCount?: number;
  isSkipped?: boolean;
  // PW_ASSERTION
  matcher?: string;
  target?: string;
  // PW_ROUTE_INTERCEPT
  urlPattern?: string;
  // PW_NAVIGATION
  url?: string;
  // PW_POM_USAGE
  className?: string;
  // PW_AUTH_CALL
  method?: string;
  // PW_HELPER_DELEGATION
  functionName?: string;
  argCount?: number;
  helperCount?: number;
};

export type PwParityObservation = Observation<PwParityObservationKind, PwParityObservationEvidence>;

// --- ast-bff-gaps output ---

export type BffGapObservationKind =
  | 'BFF_STUB_ROUTE' // BFF route file containing res.status(501)
  | 'MOCK_ROUTE' // Mock route file serving fixture data
  | 'BFF_MISSING_ROUTE' // Mock route exists but no corresponding BFF route
  | 'QUERY_HOOK_BFF_GAP'; // Query hook references endpoint with 501 stub or missing BFF

export type BffGapObservationEvidence = {
  /** API path derived from the file system location (e.g., /api/users/data-api/systems/teams) */
  apiPath?: string;
  /** Path to the BFF route file (relative to project root) */
  bffFile?: string;
  /** Path to the corresponding mock route file */
  mockFile?: string;
  /** Middleware chain extracted from the default export (e.g., withErrorHandler, withAuth, withMethod) */
  middleware?: string[];
  /** TODO comments found in the file */
  todoComments?: string[];
  /** Fixture builder calls found in mock route (e.g., buildManyConfluencePageSummaries) */
  fixtureBuilders?: string[];
  /** Response schema name referenced by the query hook's fetchApi call */
  responseSchema?: string;
  /** Query hook name that references this endpoint */
  queryHookName?: string;
  /** The fetchApi URL from the query hook */
  fetchApiUrl?: string;
  /** HTTP methods accepted by the route (from withMethod) */
  httpMethods?: string[];
};

export type BffGapObservation = Observation<BffGapObservationKind, BffGapObservationEvidence>;

export interface BffGapAnalysis {
  /** All BFF route files scanned */
  bffRoutes: { path: string; isStub: boolean }[];
  /** All mock route files scanned */
  mockRoutes: { path: string; apiPath: string }[];
  /** Observations emitted */
  observations: BffGapObservation[];
}

// --- ast-branded-check output ---

export type BrandedCheckObservationKind = 'UNBRANDED_ID_FIELD' | 'UNBRANDED_PARAM';

export type BrandedCheckObservationEvidence = {
  /** The property name (e.g., 'userId') -- for UNBRANDED_ID_FIELD */
  propertyName?: string;
  /** The type annotation found (e.g., 'string') */
  actualType: string;
  /** The branded type that should be used (e.g., 'UserId') */
  expectedType: string;
  /** The containing type/interface name -- for UNBRANDED_ID_FIELD */
  containingType?: string;
  /** The function name -- for UNBRANDED_PARAM */
  functionName?: string;
  /** The parameter name, or 'return' for return types -- for UNBRANDED_PARAM */
  parameterName?: string;
  /** The declared primitive type -- for UNBRANDED_PARAM */
  declaredType?: 'string' | 'number';
  /** Describes why the branded type applies -- for UNBRANDED_PARAM */
  evidence?: string;
};

export type BrandedCheckObservation = Observation<BrandedCheckObservationKind, BrandedCheckObservationEvidence>;

export interface BrandedCheckAnalysis {
  filePath: string;
  observations: BrandedCheckObservation[];
}

// --- ast-authz-audit output ---

export type AuthZObservationKind = 'RAW_ROLE_CHECK' | 'RAW_ROLE_EQUALITY';

export type AuthZObservationEvidence = {
  /** The expression used: 'includes', 'indexOf', 'some' */
  readonly method: string;
  /** The Role member accessed: 'ADMIN', 'TEAM_OWNER', etc. */
  readonly roleMember: string;
  /** The full expression text (truncated to 80 chars) */
  readonly expression: string;
  /** The containing function name, if any */
  readonly containingFunction?: string;
};

export type AuthZObservation = Observation<AuthZObservationKind, AuthZObservationEvidence>;

export interface AuthZAnalysis {
  readonly filePath: string;
  readonly observations: readonly AuthZObservation[];
}

// --- Plan audit observations (ast-plan-audit, MDAST-based) ---

export type PlanAuditObservationKind =
  | 'PLAN_HEADER_MISSING'
  | 'PLAN_HEADER_INVALID'
  | 'VERIFICATION_BLOCK_MISSING'
  | 'CLEANUP_FILE_MISSING'
  | 'PROMPT_FILE_MISSING'
  | 'PROMPT_VERIFICATION_MISSING'
  | 'PROMPT_DEPENDENCY_CYCLE'
  | 'PROMPT_MODE_UNSET'
  | 'STANDING_ELEMENT_MISSING'
  | 'RECONCILIATION_TEMPLATE_MISSING'
  | 'PRE_FLIGHT_CERTIFIED'
  | 'PRE_FLIGHT_CONDITIONAL'
  | 'PRE_FLIGHT_BLOCKED'
  | 'PRE_FLIGHT_MARK_MISSING'
  | 'NAMING_CONVENTION_INSTRUCTION'
  | 'CLIENT_SIDE_AGGREGATION'
  | 'DEFERRED_CLEANUP_REFERENCE'
  | 'FILE_PATH_REFERENCE'
  | 'SKILL_REFERENCE'
  | 'PROMPT_DEPENDENCY_EDGE_COUNT'
  | 'PROMPT_CHAIN_DEPTH'
  | 'PROMPT_FAN_OUT'
  | 'PLAN_PROMPT_COUNT'
  | 'PLAN_FILE_REFERENCE_DENSITY';

export type PlanAuditObservationEvidence = {
  /** Field name (PLAN_HEADER_MISSING, PLAN_HEADER_INVALID) */
  field?: string;
  /** Field value (PLAN_HEADER_INVALID) */
  value?: string;
  /** Prompt file path (PROMPT_FILE_MISSING, PROMPT_VERIFICATION_MISSING, RECONCILIATION_TEMPLATE_MISSING) */
  promptFile?: string;
  /** Prompt name (PROMPT_MODE_UNSET) */
  promptName?: string;
  /** Cycle path (PROMPT_DEPENDENCY_CYCLE) */
  cyclePath?: string[];
  /** Element name (STANDING_ELEMENT_MISSING) */
  elementName?: string;
  /** Naming instruction text (NAMING_CONVENTION_INSTRUCTION) */
  instruction?: string;
  /** Matched text (CLIENT_SIDE_AGGREGATION) */
  matchedText?: string;
  /** Deferred item text (DEFERRED_CLEANUP_REFERENCE) */
  deferredItem?: string;
  /** Referenced file path (FILE_PATH_REFERENCE) */
  referencedPath?: string;
  /** Skill name (SKILL_REFERENCE) */
  skillName?: string;
  /** Certification date (PRE_FLIGHT_CERTIFIED, PRE_FLIGHT_CONDITIONAL, PRE_FLIGHT_BLOCKED) */
  certificationDate?: string;
  /** Certification tier (PRE_FLIGHT_CERTIFIED, PRE_FLIGHT_CONDITIONAL, PRE_FLIGHT_BLOCKED) */
  certificationTier?: string;
  edgeCount?: number;
  chainDepth?: number;
  fanOut?: number;
  promptCount?: number;
  fileRefDensity?: number;
};

export type PlanAuditObservation = Observation<PlanAuditObservationKind, PlanAuditObservationEvidence>;

export interface PlanAuditResult {
  filePath: string;
  observations: PlanAuditObservation[];
}

// --- Plan audit assessments (ast-interpret-plan-audit) ---

export type PlanAuditAssessmentKind =
  // Structural - positive
  | 'HEADER_COMPLETE'
  | 'VERIFICATION_PRESENT'
  | 'CLEANUP_REFERENCED'
  | 'STANDING_ELEMENTS_COMPLETE'
  | 'CERTIFIED'
  | 'CONDITIONAL_PREFLIGHT'
  | 'BLOCKED_PREFLIGHT'
  // Structural - negative
  | 'HEADER_DEFICIENCY'
  | 'VERIFICATION_ABSENT'
  | 'CLEANUP_UNREFERENCED'
  | 'STANDING_ELEMENTS_INCOMPLETE'
  | 'CERTIFICATION_MISSING'
  // Prompt - positive
  | 'PROMPT_WELL_FORMED'
  // Prompt - negative
  | 'PROMPT_DEFICIENCY'
  | 'DEPENDENCY_CYCLE_DETECTED'
  | 'PROMPT_FILE_UNRESOLVED'
  // Risk signals
  | 'AGGREGATION_RISK'
  | 'DEFERRED_CLEANUP_NOTED'
  // Informational
  | 'CONVENTION_REFERENCE';

export type PlanAuditAssessment = Assessment<PlanAuditAssessmentKind>;

export type PlanAuditVerdict = 'CERTIFIED' | 'CONDITIONAL' | 'BLOCKED';

export interface PlanAuditVerdictReport {
  readonly verdict: PlanAuditVerdict;
  readonly score: number;
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly assessments: readonly PlanAuditAssessment[];
  readonly planFile: string;
  readonly promptFiles: readonly string[];
}

// --- ast-error-coverage output ---

export type ErrorCoverageObservationKind =
  | 'QUERY_ERROR_HANDLED'
  | 'QUERY_ERROR_UNHANDLED'
  | 'MUTATION_ERROR_HANDLED'
  | 'MUTATION_ERROR_UNHANDLED'
  | 'GLOBAL_ERROR_HANDLER';

export type ErrorCoverageObservationEvidence = {
  hookName: string;
  componentName: string;
  destructuredNames: string[];
  hasIsError: boolean;
  hasOnError: boolean;
  hasThrowOnError: boolean;
  hasTryCatch: boolean;
  hasGlobalMutationHandler: boolean;
};

export type ErrorCoverageObservation = Observation<ErrorCoverageObservationKind, ErrorCoverageObservationEvidence>;

export interface ErrorCoverageAnalysis {
  filePath: string;
  observations: ErrorCoverageObservation[];
  summary: {
    queriesTotal: number;
    queriesHandled: number;
    queriesUnhandled: number;
    mutationsTotal: number;
    mutationsHandled: number;
    mutationsUnhandled: number;
    hasGlobalHandler: boolean;
  };
}

// --------------------------------------------------------------------------
// ast-number-format observations
// --------------------------------------------------------------------------

export type NumberFormatObservationKind =
  | 'FORMAT_NUMBER_CALL'
  | 'FORMAT_INT_CALL'
  | 'FORMAT_DURATION_CALL'
  | 'FORMAT_CELL_VALUE_CALL'
  | 'RAW_TO_FIXED'
  | 'RAW_TO_LOCALE_STRING'
  | 'PERCENTAGE_DISPLAY'
  | 'INTL_NUMBER_FORMAT';

export type NumberFormatObservationEvidence = {
  readonly callee: string;
  readonly args?: readonly string[];
  readonly decimalPlaces?: number;
  readonly unitsType?: string;
  readonly containingFunction?: string;
  readonly context?: string;
};

export type NumberFormatObservation = Observation<NumberFormatObservationKind, NumberFormatObservationEvidence>;

export type NumberFormatAnalysis = {
  readonly filePath: string;
  readonly observations: readonly NumberFormatObservation[];
};

// --------------------------------------------------------------------------
// ast-null-display observations
// --------------------------------------------------------------------------

export type NullDisplayObservationKind =
  | 'NULL_COALESCE_FALLBACK'
  | 'FALSY_COALESCE_FALLBACK'
  | 'NO_FALLBACK_CELL'
  | 'HARDCODED_PLACEHOLDER'
  | 'EMPTY_STATE_MESSAGE'
  | 'ZERO_CONFLATION';

export type NullDisplayObservationEvidence = {
  readonly operator?: string;
  readonly fallbackValue?: string;
  readonly usesConstant?: boolean;
  readonly containingFunction?: string;
  readonly isTableColumn?: boolean;
  readonly context?: string;
};

export type NullDisplayObservation = Observation<NullDisplayObservationKind, NullDisplayObservationEvidence>;

export type NullDisplayAnalysis = {
  readonly filePath: string;
  readonly observations: readonly NullDisplayObservation[];
};

// --------------------------------------------------------------------------
// ast-interpret-display-format assessments
// --------------------------------------------------------------------------

export type DisplayFormatAssessmentKind =
  | 'WRONG_PLACEHOLDER'
  | 'MISSING_PLACEHOLDER'
  | 'FALSY_COALESCE_NUMERIC'
  | 'HARDCODED_DASH'
  | 'RAW_FORMAT_BYPASS'
  | 'PERCENTAGE_PRECISION_MISMATCH'
  | 'ZERO_NULL_CONFLATION'
  | 'INCONSISTENT_EMPTY_MESSAGE';

export type DisplayFormatAssessment = Assessment<DisplayFormatAssessmentKind> & {
  /** Expected decimal places for PERCENTAGE_PRECISION_MISMATCH assessments. */
  readonly expectedDecimals?: number;
};

// --------------------------------------------------------------------------
// ast-peer-deps observations
// --------------------------------------------------------------------------

export type PeerDepObservationKind = 'PEER_DEP_SATISFIED' | 'PEER_DEP_VIOLATED' | 'PEER_DEP_OPTIONAL_MISSING';

export type PeerDepObservationEvidence = {
  /** The direct dependency that declares the peerDependency */
  readonly package: string;
  /** The installed version of the direct dependency */
  readonly packageVersion: string;
  /** The peer package name */
  readonly peer: string;
  /** The semver constraint declared in peerDependencies */
  readonly constraint: string;
  /** The installed version of the peer (undefined for not-installed) */
  readonly installedPeerVersion?: string;
  /** Reason for violation (only on PEER_DEP_VIOLATED) */
  readonly reason?: 'version-mismatch' | 'not-installed';
};

export type PeerDepObservation = Observation<PeerDepObservationKind, PeerDepObservationEvidence>;

export interface PeerDepAnalysis {
  readonly projectRoot: string;
  readonly observations: readonly PeerDepObservation[];
  readonly summary: {
    readonly satisfied: number;
    readonly violated: number;
    readonly optionalMissing: number;
    readonly totalPeers: number;
  };
}

// --------------------------------------------------------------------------
// ast-test-coverage observations
// --------------------------------------------------------------------------

export type TestCoverageObservationKind = 'TEST_COVERAGE';

export type TestCoverageObservationEvidence = {
  readonly specFile: string | null;
  readonly indirectSpecs: readonly string[];
  readonly coverage: 'TESTED' | 'INDIRECTLY_TESTED' | 'UNTESTED';
  readonly riskScore: number;
  readonly risk: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly suggestedPriority: 'P2' | 'P3' | 'P4';
  readonly maxCC: number;
  readonly lineCount: number;
  readonly consumerCount: number;
};

export type TestCoverageObservation = Observation<TestCoverageObservationKind, TestCoverageObservationEvidence>;

export interface TestCoverageAnalysis {
  readonly filePath: string;
  readonly observations: readonly TestCoverageObservation[];
}

// --------------------------------------------------------------------------
// ast-interpret-test-coverage assessments
// --------------------------------------------------------------------------

export type TestGapAssessmentKind = 'TEST_GAP';

export interface TestGapDirectoryStats {
  readonly directory: string;
  readonly totalFiles: number;
  readonly tested: number;
  readonly indirectlyTested: number;
  readonly untested: number;
  readonly coveragePercent: number;
}

export type TestGapAssessment = Assessment<TestGapAssessmentKind> & {
  readonly coverage: 'UNTESTED' | 'INDIRECTLY_TESTED';
  readonly risk: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly suggestedPriority: 'P2' | 'P3' | 'P4';
  readonly directoryStats?: TestGapDirectoryStats;
};

// --------------------------------------------------------------------------
// ast-handler-structure observations
// --------------------------------------------------------------------------

export type HandlerStructureObservationKind = 'HANDLER_INLINE_LOGIC' | 'HANDLER_MULTI_METHOD';

export type HandlerInlineLogicEvidence = {
  readonly handlerLines: number;
  readonly delegatesTo: string | null;
  readonly threshold: number;
};

export type HandlerMultiMethodEvidence = {
  readonly methods: readonly string[];
};

export type HandlerStructureObservation =
  | Observation<'HANDLER_INLINE_LOGIC', HandlerInlineLogicEvidence>
  | Observation<'HANDLER_MULTI_METHOD', HandlerMultiMethodEvidence>;

export interface HandlerStructureAnalysis {
  readonly filePath: string;
  readonly observations: readonly HandlerStructureObservation[];
}

// --- Behavioral fingerprint observations (ast-behavioral) ---

export type BehavioralObservationKind =
  | 'DEFAULT_PROP_VALUE' // default value in destructured props or function params
  | 'RENDER_CAP' // .slice(0, N), .take(N), maxItems
  | 'NULL_COERCION_DISPLAY' // value ?? 'N/A', value || '-'
  | 'CONDITIONAL_RENDER_GUARD' // ternary or && guard controlling JSX visibility
  | 'JSX_STRING_LITERAL' // string literals in JSX (button text, labels, aria-labels)
  | 'COLUMN_DEFINITION' // column def arrays, CSV header arrays
  | 'STATE_INITIALIZATION' // useState/useQueryState default values
  | 'TYPE_COERCION_BOUNDARY'; // String(), Number(), toString(), parseInt/parseFloat

export type BehavioralObservationEvidence = {
  category:
    | 'state-preservation'
    | 'null-empty-display'
    | 'value-caps'
    | 'column-field-parity'
    | 'string-literal-parity'
    | 'type-coercion'
    | 'default-values'
    | 'conditional-visibility'
    | 'export-download-inclusion';
  name?: string; // prop name, variable name, column name
  value?: string; // the literal default value, cap number, string text
  containingFunction?: string;
  context?: string; // additional context (e.g., "useState", "aria-label")
};

export type BehavioralObservation = Observation<BehavioralObservationKind, BehavioralObservationEvidence>;

export interface BehavioralAnalysis {
  readonly filePath: string;
  readonly observations: readonly BehavioralObservation[];
  readonly summary: Readonly<Record<BehavioralObservationKind, number>>;
}

// ============================================================
// Unified observation types
// ============================================================

/**
 * Discriminated union of ALL concrete observation types across all AST tools.
 * The `kind` field is the discriminant.
 */
export type AnyObservation =
  | EffectObservation
  | StorageObservation
  | EnvObservation
  | SideEffectObservation
  | FeatureFlagObservation
  | TypeSafetyObservation
  | ImportObservation
  | ComplexityObservation
  | DataLayerObservation
  | HookObservation
  | ComponentObservation
  | JsxObservation
  | TestObservation
  | PwParityObservation
  | BffGapObservation
  | VtParityObservation
  | BrandedCheckObservation
  | AuthZObservation
  | ErrorCoverageObservation
  | ConcernMatrixObservation
  | ExportSurfaceObservation
  | NumberFormatObservation
  | NullDisplayObservation
  | PeerDepObservation
  | TestCoverageObservation
  | HandlerStructureObservation
  | BehavioralObservation
  | NrClientObservation
  | NrServerObservation
  | ErrorFlowObservation;

/**
 * Unified result from running one or more observation tools on a single file.
 */
export interface UnifiedObservationResult {
  readonly filePath: string;
  readonly observations: AnyObservation[];
}

// ============================================================
// Intent matcher types
// ============================================================

export type IntentClassification = 'PRESERVED' | 'INTENTIONALLY_REMOVED' | 'ACCIDENTALLY_DROPPED' | 'ADDED' | 'CHANGED';

export interface IntentSignal {
  kind: string;
  file: string;
  line: number;
  evidence: unknown;
  classification: IntentClassification;
  confidence: 'high' | 'low';
  matchedTo?: {
    file: string;
    line: number;
    kind: string;
  };
  rationale: string;
}

export interface IntentReport {
  before: { files: string[]; signalCount: number };
  after: { files: string[]; signalCount: number };
  signals: IntentSignal[];
  score: number;
  summary: {
    preserved: number;
    intentionallyRemoved: number;
    accidentallyDropped: number;
    added: number;
    changed: number;
  };
}

// ============================================================
// Audit context (for intent interpretation)
// ============================================================

export interface AuditContext {
  /** Observation kinds the audit flagged as violations */
  flaggedKinds: Set<string>;
  /** Specific file:line locations flagged */
  flaggedLocations: { file: string; line: number; kind: string }[];
  /** Refactor type for heuristic intent inference */
  refactorType: 'component' | 'service-hook' | 'provider' | 'route' | 'hook' | 'module' | 'api-handler';
}

// ============================================================
// Refactor signal pair types (ast-refactor-intent)
// ============================================================

export interface RefactorSignalPair {
  before: { files: string[]; observations: AnyObservation[] };
  after: { files: string[]; observations: AnyObservation[] };
  unmatched: AnyObservation[];
  novel: AnyObservation[];
  matched: { before: AnyObservation; after: AnyObservation; similarity: number }[];
}

// ============================================================
// ast-vitest-parity output (Vitest spec inventory)
// ============================================================

export interface VtDescribeBlock {
  readonly name: string;
  readonly nestedDepth: number;
  readonly testCount: number;
  readonly line: number;
}

export interface VtTestBlock {
  readonly name: string;
  readonly parentDescribe: string | null;
  readonly assertionCount: number;
  readonly line: number;
}

export interface VtMockDeclaration {
  readonly mockTarget: string;
  readonly mockType: 'vi.mock' | 'vi.spyOn' | 'vi.fn';
  readonly parentDescribe: string | null;
  readonly line: number;
}

export interface VtAssertion {
  readonly matcher: string;
  readonly target: string;
  readonly negated: boolean;
  readonly parentTest: string;
  readonly line: number;
}

export interface VtRenderCall {
  readonly component: string;
  readonly hasWrapper: boolean;
  readonly parentTest: string;
  readonly line: number;
}

export interface VtFixtureImport {
  readonly source: string;
  readonly builders: string[];
  readonly line: number;
}

export interface VtLifecycleHook {
  readonly hookType: 'beforeEach' | 'afterEach' | 'beforeAll' | 'afterAll';
  readonly cleanupTargets: string[];
  readonly scope: string;
  readonly line: number;
}

export interface VtSpecInventory {
  readonly file: string;
  readonly describes: VtDescribeBlock[];
  readonly tests: VtTestBlock[];
  readonly mocks: VtMockDeclaration[];
  readonly assertions: VtAssertion[];
  readonly renders: VtRenderCall[];
  readonly fixtureImports: VtFixtureImport[];
  readonly lifecycleHooks: VtLifecycleHook[];
}

// --- ast-vitest-parity observations ---

export type VtParityObservationKind =
  | 'VT_DESCRIBE_BLOCK'
  | 'VT_TEST_BLOCK'
  | 'VT_ASSERTION'
  | 'VT_MOCK_DECLARATION'
  | 'VT_RENDER_CALL'
  | 'VT_FIXTURE_IMPORT'
  | 'VT_BEFORE_EACH'
  | 'VT_AFTER_EACH';

export type VtParityObservationEvidence = {
  readonly name?: string;
  readonly nestedDepth?: number;
  readonly testCount?: number;
  readonly parentDescribe?: string | null;
  readonly assertionCount?: number;
  readonly matcher?: string;
  readonly target?: string;
  readonly negated?: boolean;
  readonly parentTest?: string;
  readonly mockTarget?: string;
  readonly mockType?: string;
  readonly component?: string;
  readonly hasWrapper?: boolean;
  readonly source?: string;
  readonly builders?: string[];
  readonly cleanupTargets?: string[];
  readonly scope?: string;
  readonly hookType?: string;
};

export type VtParityObservation = Observation<VtParityObservationKind, VtParityObservationEvidence>;

// --- ast-interpret-vitest-parity output (Vitest parity interpreter) ---

export type VtParityStatus = 'PARITY' | 'REDUCED' | 'EXPANDED' | 'NOT_PORTED';

export interface VtTestMatch {
  readonly sourceTest: string;
  readonly sourceFile: string;
  readonly targetTest: string | null;
  readonly targetFile: string | null;
  readonly status: VtParityStatus;
  readonly sourceAssertions: number;
  readonly targetAssertions: number;
  readonly sourceMocks: readonly string[];
  readonly targetMocks: readonly string[];
  readonly confidence: 'high' | 'low';
  readonly similarity: number;
}

export interface VtParityScore {
  readonly total: number;
  readonly matched: number;
  readonly parity: number;
  readonly reduced: number;
  readonly expanded: number;
  readonly notPorted: number;
  readonly novel: number;
  readonly score: number;
}

export interface VtParityReport {
  readonly matches: readonly VtTestMatch[];
  readonly score: VtParityScore;
  readonly sourceFiles: readonly string[];
  readonly targetFiles: readonly string[];
}

// ============================================================
// ast-concern-matrix output (behavioral concern checklist)
// ============================================================

export type ConcernMatrixObservationKind =
  | 'CONTAINER_HANDLES_LOADING'
  | 'CONTAINER_HANDLES_ERROR'
  | 'CONTAINER_HANDLES_EMPTY'
  | 'CONTAINER_HANDLES_PERMISSION'
  | 'CONTAINER_MISSING_LOADING'
  | 'CONTAINER_MISSING_ERROR'
  | 'CONTAINER_MISSING_EMPTY'
  | 'CONTAINER_MISSING_PERMISSION';

export type ConcernMatrixObservationEvidence = {
  componentName: string;
  queryHookCount: number;
  mutationHookCount: number;
  loadingSignals: string[];
  errorSignals: string[];
  emptySignals: string[];
  permissionSignals: string[];
};

export type ConcernMatrixObservation = Observation<ConcernMatrixObservationKind, ConcernMatrixObservationEvidence>;

export interface ConcernMatrixAnalysis {
  filePath: string;
  observations: ConcernMatrixObservation[];
  summary: {
    componentName: string;
    handlesLoading: boolean;
    handlesError: boolean;
    handlesEmpty: boolean;
    handlesPermission: boolean;
    /** e.g. "3/4" or "2/3" (permission excluded if not applicable) */
    score: string;
  };
}

// ============================================================
// ast-export-surface output (isolated export extraction)
// ============================================================

export type ExportSurfaceObservationKind = 'EXPORT_SURFACE';

export type ExportSurfaceObservationEvidence = {
  name: string;
  exportKind: 'function' | 'class' | 'type' | 'interface' | 'const' | 'enum' | 'default' | 'reexport';
  isTypeOnly: boolean;
  /** For reexports: the module specifier */
  source?: string;
};

export type ExportSurfaceObservation = Observation<ExportSurfaceObservationKind, ExportSurfaceObservationEvidence>;

export interface ExportSurfaceAnalysis {
  filePath: string;
  observations: ExportSurfaceObservation[];
}

// ============================================================
// ast-skill-analysis output (MDAST-based skill file analysis)
// ============================================================

export type SkillAnalysisObservationKind =
  | 'SKILL_SECTION' // heading with depth, text, line
  | 'SKILL_STEP' // numbered step heading (## Step N: ...)
  | 'SKILL_SECTION_ROLE' // HTML comment role annotation (<!-- role: X -->) associated with a heading
  | 'SKILL_CODE_BLOCK' // fenced code block (lang, content, line)
  | 'SKILL_COMMAND_REF' // shell command in code block or inline code
  | 'SKILL_FILE_PATH_REF' // file path reference with exists-on-disk check
  | 'SKILL_CROSS_REF' // reference to another skill (by name)
  | 'SKILL_DOC_REF' // reference to a docs/ file
  | 'SKILL_TABLE' // parsed pipe table (headers + row count)
  | 'SKILL_CHECKLIST_ITEM' // checklist entry (checked/unchecked)
  | 'SKILL_SUPERSEDED_PATTERN' // code block or text matches a superseded convention pattern
  | 'SKILL_MISSING_CONVENTION' // skill is in scope for a convention but does not reference current pattern
  | 'SKILL_CONVENTION_ALIGNED' // skill is in scope, references current pattern, no superseded patterns found
  | 'SKILL_INVALID_ROLE'; // HTML comment matches role pattern but the role name is not valid

/** Valid section role names for the structured skill format. */
export type SkillSectionRole = 'emit' | 'avoid' | 'detect' | 'guidance' | 'reference' | 'workflow' | 'cleanup';

export type SkillAnalysisObservationEvidence = {
  /** Heading text (SKILL_SECTION, SKILL_STEP, SKILL_SECTION_ROLE) */
  text?: string;
  /** Heading depth 1-6 (SKILL_SECTION, SKILL_STEP, SKILL_SECTION_ROLE) */
  depth?: number;
  /** Step number extracted from "Step N" pattern (SKILL_STEP) */
  stepNumber?: number;
  /** Effective section role, either from HTML comment annotation or inherited from parent heading (SKILL_SECTION, SKILL_SECTION_ROLE) */
  sectionRole?: SkillSectionRole;
  /** Whether the role was inherited from a parent heading (SKILL_SECTION) */
  roleInherited?: boolean;
  /** Code block language (SKILL_CODE_BLOCK) */
  lang?: string;
  /** Code block or command content, truncated (SKILL_CODE_BLOCK, SKILL_COMMAND_REF) */
  content?: string;
  /** Command classification (SKILL_COMMAND_REF) */
  commandType?: 'typecheck' | 'test' | 'build' | 'lint' | 'git' | 'npm' | 'ast-tool' | 'other';
  /** Whether the referenced path exists on disk (SKILL_FILE_PATH_REF) */
  exists?: boolean;
  /** The referenced path string (SKILL_FILE_PATH_REF, SKILL_DOC_REF) */
  referencedPath?: string;
  /** Context where the path was found (SKILL_FILE_PATH_REF) */
  pathContext?: 'code-block' | 'inline-code' | 'table' | 'text';
  /** Whether nearby text signals intent to create this path (SKILL_FILE_PATH_REF) */
  creationIntent?: boolean;
  /** Skill name (SKILL_CROSS_REF) */
  skillName?: string;
  /** Whether the referenced skill exists (SKILL_CROSS_REF, SKILL_DOC_REF) */
  refExists?: boolean;
  /** Table headers (SKILL_TABLE) */
  tableHeaders?: string[];
  /** Table row count (SKILL_TABLE) */
  tableRowCount?: number;
  /** Whether the checklist item is checked (SKILL_CHECKLIST_ITEM) */
  checked?: boolean;
  /** Checklist item text (SKILL_CHECKLIST_ITEM) */
  itemText?: string;
  /** Invalid role name from a malformed annotation (SKILL_INVALID_ROLE) */
  invalidRoleName?: string;
  /** Convention rule ID (SKILL_SUPERSEDED_PATTERN, SKILL_MISSING_CONVENTION) */
  conventionId?: string;
  /** Convention message (SKILL_SUPERSEDED_PATTERN, SKILL_MISSING_CONVENTION) */
  conventionMessage?: string;
  /** The matched superseded pattern text (SKILL_SUPERSEDED_PATTERN) */
  matchedPattern?: string;
};

export type SkillAnalysisObservation = Observation<SkillAnalysisObservationKind, SkillAnalysisObservationEvidence>;

export interface SkillAnalysisResult {
  filePath: string;
  /** Skill name derived from parent directory name */
  skillName: string;
  /** Skill category derived from name prefix (build, refactor, audit, orchestrate, other) */
  category: 'build' | 'refactor' | 'audit' | 'orchestrate' | 'other';
  observations: SkillAnalysisObservation[];
}

// --- ast-interpret-skill-quality assessments ---

export type SkillQualityAssessmentKind =
  | 'STALE_FILE_PATH' // referenced path does not exist on disk
  | 'ASPIRATIONAL_PATH' // path does not exist but surrounding text signals intent to create it
  | 'STALE_COMMAND' // command references nonexistent script or uses deprecated pattern
  | 'BROKEN_CROSS_REF' // skill reference points to nonexistent skill
  | 'BROKEN_DOC_REF' // doc reference points to nonexistent file
  | 'MISSING_SECTION' // category-required section not found
  | 'SECTION_COMPLETE' // all category-required sections present
  | 'PATH_VALID' // neutral: file path verified as existing
  | 'CROSS_REF_VALID' // neutral: skill cross-ref verified as existing
  | 'CONVENTION_DRIFT' // skill references superseded pattern and/or misses current convention
  | 'CONVENTION_ALIGNED' // skill references current convention pattern
  | 'MISSING_SECTION_ROLE' // top-level heading lacks a role annotation
  | 'ROLE_REQUIREMENT_MET' // all required roles for the skill category are present
  | 'ROLE_REQUIREMENT_MISSING' // a required role for the skill category is absent
  | 'INVALID_ROLE_ANNOTATION'; // HTML comment has role: pattern but the role name is not valid (typo)

export type SkillQualityAssessment = Assessment<SkillQualityAssessmentKind>;

export interface SkillQualityReport {
  readonly skillName: string;
  readonly category: 'build' | 'refactor' | 'audit' | 'orchestrate' | 'other';
  readonly assessments: readonly SkillQualityAssessment[];
  readonly score: number;
  readonly staleCount: number;
  readonly missingCount: number;
  readonly conventionDriftCount: number;
  readonly missingRoleCount: number;
  readonly missingRequiredRoleCount: number;
}

// ============================================================
// ast-nr-client output (New Relic browser agent gap detection)
// ============================================================

export type NrClientObservationKind =
  | 'NR_NREUM_CALL'
  | 'NR_REPORT_ERROR_CALL'
  | 'NR_MONITOR_API_CALL'
  | 'NR_ROUTE_TRACKER'
  | 'NR_SCRIPT_INJECTION'
  | 'NR_TRACER_MISUSE'
  | 'NR_MISSING_ERROR_HANDLER'
  | 'NR_MISSING_USER_ID'
  | 'NR_MISSING_ROUTE_TRACK'
  | 'NR_MISSING_UNHANDLED_REJECTION'
  | 'NR_MISSING_WEB_VITALS';

export type NrClientObservationEvidence = {
  readonly callSite?: string;
  readonly nreumMethod?: string;
  readonly wrapperFunction?: string;
  readonly containingFunction?: string;
  readonly componentName?: string;
  readonly pageFile?: string;
  readonly reason?: string;
  readonly preStartedVariable?: string;
  readonly interactionLine?: number;
};

export type NrClientObservation = Observation<NrClientObservationKind, NrClientObservationEvidence>;

export interface NrClientAnalysis {
  filePath: string;
  observations: NrClientObservation[];
  summary: {
    nreumCalls: number;
    reportErrorCalls: number;
    monitorApiCalls: number;
    missingCount: number;
  };
}

// ============================================================
// ast-nr-server output (New Relic server APM gap detection)
// ============================================================

export type NrServerObservationKind =
  | 'NR_APM_IMPORT'
  | 'NR_NOTICE_ERROR_CALL'
  | 'NR_CUSTOM_ATTRS_CALL'
  | 'NR_CUSTOM_SEGMENT'
  | 'NR_TXN_NAME_CALL'
  | 'NR_MISSING_ERROR_REPORT'
  | 'NR_MISSING_CUSTOM_ATTRS'
  | 'NR_MISSING_DB_SEGMENT'
  | 'NR_MISSING_TXN_NAME'
  | 'NR_MISSING_STARTUP_HOOK';

export type NrServerObservationEvidence = {
  readonly callSite?: string;
  readonly middleware?: string;
  readonly containingFunction?: string;
  readonly dbClient?: string;
  readonly routePath?: string;
  readonly catchBlockLine?: number;
  readonly errorSink?: string;
  readonly reason?: string;
  readonly checkedPaths?: string;
};

export type NrServerObservation = Observation<NrServerObservationKind, NrServerObservationEvidence>;

export interface NrServerAnalysis {
  filePath: string;
  observations: NrServerObservation[];
  summary: {
    apmImports: number;
    noticeErrorCalls: number;
    customAttrsCalls: number;
    missingCount: number;
  };
}

// ============================================================
// ast-error-flow output (catch block error sink classification)
// ============================================================

export type ErrorFlowObservationKind = 'ERROR_SINK_TYPE';

export type ErrorSinkClassification = 'console' | 'newrelic' | 'rethrow' | 'swallowed' | 'response' | 'callback';

export type ErrorFlowObservationEvidence = {
  readonly sink: ErrorSinkClassification;
  readonly catchLine: number;
  readonly containingFunction: string;
  readonly sinkExpression?: string;
  readonly hasMultipleSinks?: boolean;
};

export type ErrorFlowObservation = Observation<ErrorFlowObservationKind, ErrorFlowObservationEvidence>;

export interface ErrorFlowAnalysis {
  filePath: string;
  observations: ErrorFlowObservation[];
  summary: Readonly<Record<ErrorSinkClassification, number>>;
}

// ============================================================
// Audit Finding Types (ast-audit)
// ============================================================

export type FindingCategory = 'Bug' | 'Architecture' | 'Testing' | 'Style';
export type FindingTrack = 'fe' | 'bff';

/** Mirrors FindingPriority from ast-config.ts to avoid circular import. */
export type AuditPriority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

export interface Finding {
  readonly id: string;
  readonly kind: string;
  readonly priority: AuditPriority;
  readonly category: FindingCategory;
  readonly file: string;
  readonly line?: number;
  readonly symbol?: string;
  readonly evidence: string;
  readonly rationale: readonly string[];
  readonly confidence: 'high' | 'medium' | 'low';
  readonly source: string;
  readonly astConfirmed: boolean;
  readonly track: FindingTrack;
}
