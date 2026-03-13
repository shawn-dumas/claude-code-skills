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
  components: Array<{
    name: string;
    returnStartLine: number;
    returnEndLine: number;
    returnLineCount: number;
    violations: JsxViolation[];
  }>;
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
  | 'EFFECT_DOM_API';

export type EffectObservationEvidence = {
  effectLine: number;
  parentFunction?: string;
  depArray?: string[];
  identifier?: string;
  targetObject?: string;
  method?: string;
};

export type EffectObservation = Observation<EffectObservationKind, EffectObservationEvidence>;

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
  contributors: Array<{ type: string; line: number }>;
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
  | 'PLAYWRIGHT_IMPORT'; // import from @playwright/test or fixture

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
};

export type TestObservation = Observation<TestObservationKind, TestObservationEvidence>;
