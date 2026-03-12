import {
  type SourceFile,
  type VariableDeclaration,
  type ParameterDeclaration,
  type TypeNode,
  type InterfaceDeclaration,
  type TypeAliasDeclaration,
  type PropertySignature,
  Node,
} from 'ts-morph';
import path from 'path';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getBody, detectComponents } from './shared';
import type { ReactInventory, ComponentInfo, HookCall, UseEffectInfo, PropField } from './types';
import { MAY_REMAIN_HOOKS, KNOWN_CONTEXT_HOOKS, REACT_BUILTIN_HOOKS } from './types';

// ---------------------------------------------------------------------------
// Import resolution (lightweight, file-scoped)
// ---------------------------------------------------------------------------

interface ResolvedImport {
  specifier: string;
  sourcePath: string | null;
  rawSource: string;
}

function resolveImportsForFile(sf: SourceFile): ResolvedImport[] {
  const results: ResolvedImport[] = [];

  for (const decl of sf.getImportDeclarations()) {
    const rawSource = decl.getModuleSpecifierValue();
    const resolved = decl.getModuleSpecifierSourceFile();
    const sourcePath = resolved ? path.relative(PROJECT_ROOT, resolved.getFilePath()) : null;

    const defaultImport = decl.getDefaultImport();
    if (defaultImport) {
      results.push({ specifier: defaultImport.getText(), sourcePath, rawSource });
    }

    for (const named of decl.getNamedImports()) {
      const alias = named.getAliasNode();
      const localName = alias ? alias.getText() : named.getName();
      results.push({ specifier: localName, sourcePath, rawSource });
    }

    const ns = decl.getNamespaceImport();
    if (ns) {
      results.push({ specifier: ns.getText(), sourcePath, rawSource });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Hook classification
// ---------------------------------------------------------------------------

type HookClassification = HookCall['classification'];

const TANSTACK_QUERY_HOOKS = new Set(['useQuery', 'useMutation', 'useInfiniteQuery']);

function classifyByNameList(hookName: string): HookClassification | null {
  if ((MAY_REMAIN_HOOKS as readonly string[]).includes(hookName)) return 'may-remain';
  if (hookName.startsWith('use') && hookName.endsWith('Scope') && hookName.length > 8) return 'may-remain';
  if ((REACT_BUILTIN_HOOKS as readonly string[]).includes(hookName)) return 'state-utility';
  return null;
}

function classifyByImportPath(hookName: string, resolvedImports: ResolvedImport[]): HookClassification | null {
  const imp = resolvedImports.find(i => i.specifier === hookName);
  if (!imp) return null;

  const src = imp.sourcePath ?? imp.rawSource;
  if (src.includes('services/hooks') || src.includes('@tanstack/react-query')) return 'service';
  if (src.includes('providers/') || src.includes('context/')) return 'context';
  if (src.includes('shared/hooks')) return 'dom-utility';
  if (TANSTACK_QUERY_HOOKS.has(hookName)) return 'service';

  return null;
}

function classifyByLocalBody(hookName: string, localHookBodies: Map<string, Node>): HookClassification | null {
  const localBody = localHookBodies.get(hookName);
  if (!localBody) return null;

  const bodyText = localBody.getText();
  if (bodyText.includes('useContext')) return 'context';
  if (bodyText.includes('useQuery') || bodyText.includes('useMutation') || bodyText.includes('useInfiniteQuery')) {
    return 'service';
  }
  return null;
}

function classifyByHeuristic(hookName: string): HookClassification {
  if ((KNOWN_CONTEXT_HOOKS as readonly string[]).includes(hookName)) return 'context';
  if (TANSTACK_QUERY_HOOKS.has(hookName)) return 'service';
  if (hookName === 'useContext') return 'context';
  return 'unknown';
}

function classifyHook(
  hookName: string,
  resolvedImports: ResolvedImport[],
  localHookBodies: Map<string, Node>,
): HookClassification {
  return (
    classifyByNameList(hookName) ??
    classifyByImportPath(hookName, resolvedImports) ??
    classifyByLocalBody(hookName, localHookBodies) ??
    classifyByHeuristic(hookName)
  );
}

// ---------------------------------------------------------------------------
// Hook call extraction (direct function body only)
// ---------------------------------------------------------------------------

function isHookCall(name: string): boolean {
  return (name.startsWith('use') && name.length > 3 && name[3] >= 'A' && name[3] <= 'Z') || name === 'useId';
}

function getDestructuredNames(decl: VariableDeclaration | null): string[] {
  if (!decl) return [];
  const nameNode = decl.getNameNode();

  if (Node.isArrayBindingPattern(nameNode)) {
    return nameNode
      .getElements()
      .map(el => {
        if (Node.isBindingElement(el)) return el.getName();
        return '';
      })
      .filter(Boolean);
  }

  if (Node.isObjectBindingPattern(nameNode)) {
    return nameNode
      .getElements()
      .map(el => {
        if (Node.isBindingElement(el)) {
          const propName = el.getPropertyNameNode();
          if (propName) return el.getName();
          return el.getName();
        }
        return '';
      })
      .filter(Boolean);
  }

  return [];
}

function extractHookCalls(
  funcNode: Node,
  parentName: string,
  resolvedImports: ResolvedImport[],
  localHookBodies: Map<string, Node>,
): HookCall[] {
  const hooks: HookCall[] = [];
  const body = getBody(funcNode);
  if (!body) return hooks;

  // Only look at direct statements in the function body, not nested functions
  for (const stmt of body.getStatements()) {
    visitStatementForHooks(stmt, parentName, resolvedImports, localHookBodies, hooks);
  }

  return hooks;
}

function visitStatementForHooks(
  node: Node,
  parentName: string,
  resolvedImports: ResolvedImport[],
  localHookBodies: Map<string, Node>,
  hooks: HookCall[],
): void {
  // Variable declaration: const [x, y] = useHook()
  if (Node.isVariableStatement(node)) {
    for (const decl of node.getDeclarationList().getDeclarations()) {
      const init = decl.getInitializer();
      if (init && Node.isCallExpression(init)) {
        const callName = init.getExpression().getText();
        if (isHookCall(callName)) {
          hooks.push({
            name: callName,
            line: init.getStartLineNumber(),
            column: init.getSourceFile().getLineAndColumnAtPos(init.getStart()).column,
            parentFunction: parentName,
            destructuredNames: getDestructuredNames(decl),
            classification: classifyHook(callName, resolvedImports, localHookBodies),
          });
        }
      }
    }
    return;
  }

  // Expression statement: useHook() (no assignment)
  if (Node.isExpressionStatement(node)) {
    const expr = node.getExpression();
    if (Node.isCallExpression(expr)) {
      const callName = expr.getExpression().getText();
      if (isHookCall(callName)) {
        hooks.push({
          name: callName,
          line: expr.getStartLineNumber(),
          column: expr.getSourceFile().getLineAndColumnAtPos(expr.getStart()).column,
          parentFunction: parentName,
          destructuredNames: [],
          classification: classifyHook(callName, resolvedImports, localHookBodies),
        });
      }
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// useEffect body analysis
// ---------------------------------------------------------------------------

/**
 * Collect useState setter names from a function body's direct statements.
 */
function collectStateSetters(body: Node & { getStatements(): Node[] }): Set<string> {
  const stateSetters = new Set<string>();
  for (const stmt of body.getStatements()) {
    if (!Node.isVariableStatement(stmt)) continue;
    for (const decl of stmt.getDeclarationList().getDeclarations()) {
      const init = decl.getInitializer();
      if (!init || !Node.isCallExpression(init)) continue;
      if (init.getExpression().getText() !== 'useState') continue;
      const nameNode = decl.getNameNode();
      if (!Node.isArrayBindingPattern(nameNode)) continue;
      const elements = nameNode.getElements();
      if (elements.length >= 2 && Node.isBindingElement(elements[1])) {
        stateSetters.add(elements[1].getName());
      }
    }
  }
  return stateSetters;
}

/**
 * Build a UseEffectInfo from a useEffect/useLayoutEffect CallExpression.
 */
function buildEffectInfo(
  expr: Node & { getArguments(): Node[] },
  parentName: string,
  stateSetters: Set<string>,
): UseEffectInfo | null {
  const args = expr.getArguments();
  if (args.length === 0) return null;

  const callback = args[0];
  const depArg = args.length > 1 ? args[1] : null;

  let depArray: string[] | 'none' = 'none';
  if (depArg && Node.isArrayLiteralExpression(depArg)) {
    depArray = depArg.getElements().map(el => el.getText());
  }

  return {
    line: expr.getStartLineNumber(),
    parentFunction: parentName,
    depArray,
    hasCleanup: analyzeCleanup(callback),
    bodyAnalysis: analyzeEffectBody(callback, stateSetters),
  };
}

const EFFECT_HOOK_NAMES = new Set(['useEffect', 'useLayoutEffect']);

function extractUseEffects(funcNode: Node, parentName: string, _sf: SourceFile): UseEffectInfo[] {
  const body = getBody(funcNode);
  if (!body) return [];

  const stateSetters = collectStateSetters(body);
  const effects: UseEffectInfo[] = [];

  for (const stmt of body.getStatements()) {
    if (!Node.isExpressionStatement(stmt)) continue;
    const expr = stmt.getExpression();
    if (!Node.isCallExpression(expr)) continue;
    if (!EFFECT_HOOK_NAMES.has(expr.getExpression().getText())) continue;

    const info = buildEffectInfo(expr, parentName, stateSetters);
    if (info) effects.push(info);
  }

  return effects;
}

function analyzeCleanup(callback: Node): boolean {
  // Check if the callback's body has a return statement with a function
  if (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) {
    const body = callback.getBody();
    if (!body) return false;

    if (Node.isBlock(body)) {
      for (const stmt of body.getStatements()) {
        if (Node.isReturnStatement(stmt)) {
          const expr = stmt.getExpression();
          if (expr && (Node.isArrowFunction(expr) || Node.isFunctionExpression(expr))) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

const FETCH_FUNCTIONS = new Set(['fetch', 'fetchApi']);
const TIMER_FUNCTIONS = new Set(['setTimeout', 'setInterval', 'requestAnimationFrame']);
const ROUTER_NAV_METHODS = new Set(['push', 'replace']);
const STORAGE_OBJECTS = new Set(['localStorage', 'sessionStorage']);
const STORAGE_IDENTIFIERS = new Set(['localStorage', 'sessionStorage', 'readStorage', 'writeStorage', 'removeStorage']);
const NAVIGATE_FUNCTIONS = new Set(['navigate']);

function analyzeEffectBody(callback: Node, knownSetters: Set<string>): UseEffectInfo['bodyAnalysis'] {
  const result: UseEffectInfo['bodyAnalysis'] = {
    callsSetState: false,
    stateSetters: [],
    callsFetch: false,
    callsNavigation: false,
    callsStorage: false,
    callsToast: false,
    hasTimers: false,
  };

  const stateSetters: string[] = [];

  callback.forEachDescendant(node => {
    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();

      // Direct function calls: check identifier name
      if (Node.isIdentifier(callee)) {
        const name = callee.getText();
        if (FETCH_FUNCTIONS.has(name)) result.callsFetch = true;
        if (TIMER_FUNCTIONS.has(name)) result.hasTimers = true;
        if (name === 'toast') result.callsToast = true;
        if (NAVIGATE_FUNCTIONS.has(name)) result.callsNavigation = true;
        if (knownSetters.has(name) && !stateSetters.includes(name)) stateSetters.push(name);
        if (name === 'dispatch' && !stateSetters.includes('dispatch')) stateSetters.push('dispatch');
      }

      // Property access calls: obj.method()
      if (Node.isPropertyAccessExpression(callee)) {
        const obj = callee.getExpression().getText();
        const method = callee.getName();
        if (obj === 'router' && ROUTER_NAV_METHODS.has(method)) result.callsNavigation = true;
        if (STORAGE_OBJECTS.has(obj)) result.callsStorage = true;
        if (obj === 'toast') result.callsToast = true;
        // axios.get(), axios.post(), etc.
        if (obj === 'axios') result.callsFetch = true;
      }
    }

    // Bare identifier references for storage and axios
    if (Node.isIdentifier(node)) {
      const name = node.getText();
      if (STORAGE_IDENTIFIERS.has(name)) result.callsStorage = true;
      if (name === 'axios') result.callsFetch = true;
    }
  });

  result.stateSetters = stateSetters;
  result.callsSetState = stateSetters.length > 0;
  return result;
}

// ---------------------------------------------------------------------------
// Props extraction
// ---------------------------------------------------------------------------

function getFirstParam(funcNode: Node): ParameterDeclaration | null {
  if (Node.isFunctionDeclaration(funcNode) || Node.isArrowFunction(funcNode) || Node.isFunctionExpression(funcNode)) {
    const params = funcNode.getParameters();
    return params.length > 0 ? params[0] : null;
  }
  return null;
}

/**
 * When binding-extracted fields all have unknown types, try the wrapper's
 * generic type arg and merge hasDefault info from the binding.
 */
function mergeWithWrapperGeneric(fields: PropField[], wrapperCall: Node, sf: SourceFile): PropField[] | null {
  if (fields.length === 0 || !fields.every(f => f.type === 'unknown')) return null;

  const genericFields = extractPropsFromWrapperGeneric(wrapperCall, sf);
  if (genericFields.length === 0) return null;

  const defaultNames = new Set(fields.filter(f => f.hasDefault).map(f => f.name));
  for (const gf of genericFields) {
    if (defaultNames.has(gf.name)) gf.hasDefault = true;
  }
  return genericFields;
}

function extractProps(funcNode: Node, sf: SourceFile, wrapperCall: Node | null): PropField[] {
  const firstParam = getFirstParam(funcNode);
  if (!firstParam) return [];

  const nameNode = firstParam.getNameNode();

  if (Node.isObjectBindingPattern(nameNode)) {
    const fields = extractPropsFromObjectBinding(nameNode, firstParam, sf);
    if (wrapperCall) {
      return mergeWithWrapperGeneric(fields, wrapperCall, sf) ?? fields;
    }
    return fields;
  }

  const typeNode = firstParam.getTypeNode();
  if (typeNode) return extractPropsFromTypeNode(typeNode, sf, firstParam);
  if (wrapperCall) return extractPropsFromWrapperGeneric(wrapperCall, sf);

  return [];
}

function extractPropsFromWrapperGeneric(wrapperCall: Node, sf: SourceFile): PropField[] {
  if (!Node.isCallExpression(wrapperCall)) return [];

  const typeArgs = wrapperCall.getTypeArguments();
  if (typeArgs.length < 2) return [];

  // For forwardRef<Ref, Props>, the second type arg is the Props type
  const propsTypeArg = typeArgs[1];
  const propsTypeName = propsTypeArg.getText();
  return resolveNamedType(propsTypeName, sf);
}

function extractPropsFromObjectBinding(binding: Node, param: ParameterDeclaration, sf: SourceFile): PropField[] {
  if (!Node.isObjectBindingPattern(binding)) return [];

  const typeNode = param.getTypeNode();
  const elements = binding.getElements();

  // Build a set of default-valued prop names from the destructuring
  const defaultNames = new Set<string>();
  for (const el of elements) {
    if (Node.isBindingElement(el) && el.getInitializer()) {
      defaultNames.add(el.getName());
    }
  }

  // If there is a type annotation, extract from the type for full info
  if (typeNode) {
    const fields = extractPropsFromTypeNode(typeNode, sf, param);
    // Merge hasDefault info from the destructuring
    for (const field of fields) {
      if (defaultNames.has(field.name)) {
        field.hasDefault = true;
      }
    }
    return fields;
  }

  // Fallback: extract from the binding elements themselves (inline type)
  return elements
    .map(el => {
      if (!Node.isBindingElement(el)) {
        return { name: '', type: 'unknown', optional: false, hasDefault: false, isCallback: false };
      }
      const name = el.getName();
      return {
        name,
        type: 'unknown',
        optional: false,
        hasDefault: !!el.getInitializer(),
        isCallback: false,
      };
    })
    .filter(f => f.name !== '');
}

function extractPropsFromTypeNode(typeNode: TypeNode, sf: SourceFile, _param?: ParameterDeclaration): PropField[] {
  // Inline type literal: { a: string; b: number }
  if (Node.isTypeLiteral(typeNode)) {
    return typeNode
      .getMembers()
      .filter((m): m is PropertySignature => Node.isPropertySignature(m))
      .map(prop => propSignatureToField(prop));
  }

  // Type reference: FooProps
  if (Node.isTypeReference(typeNode)) {
    const typeName = typeNode.getTypeName().getText();
    return resolveNamedType(typeName, sf);
  }

  // Intersection type: A & B
  if (Node.isIntersectionTypeNode(typeNode)) {
    const fields: PropField[] = [];
    for (const part of typeNode.getTypeNodes()) {
      fields.push(...extractPropsFromTypeNode(part, sf));
    }
    return fields;
  }

  return [];
}

function resolveNamedType(typeName: string, sf: SourceFile): PropField[] {
  // Look for interface declaration in the same file
  const iface = sf.getInterface(typeName);
  if (iface) {
    return extractPropsFromInterface(iface, sf);
  }

  // Look for type alias in the same file
  const typeAlias = sf.getTypeAlias(typeName);
  if (typeAlias) {
    return extractPropsFromTypeAlias(typeAlias, sf);
  }

  return [];
}

function extractPropsFromInterface(iface: InterfaceDeclaration, sf: SourceFile): PropField[] {
  const fields: PropField[] = [];

  // Handle extends clauses
  for (const ext of iface.getExtends()) {
    const baseName = ext.getExpression().getText();
    fields.push(...resolveNamedType(baseName, sf));
  }

  // Own properties
  for (const prop of iface.getProperties()) {
    fields.push(propSignatureToField(prop));
  }

  return fields;
}

function extractPropsFromTypeAlias(alias: TypeAliasDeclaration, sf: SourceFile): PropField[] {
  const typeNode = alias.getTypeNode();
  if (!typeNode) return [];
  return extractPropsFromTypeNode(typeNode, sf);
}

function propSignatureToField(prop: PropertySignature): PropField {
  const name = prop.getName();
  const typeText = prop.getTypeNode()?.getText() ?? 'unknown';
  const optional = prop.hasQuestionToken();
  const isCallback = isFunctionType(typeText, name);

  return { name, type: typeText, optional, hasDefault: false, isCallback };
}

function isFunctionType(typeText: string, name: string): boolean {
  if (typeText.startsWith('(') && typeText.includes('=>')) return true;
  if (typeText.includes('=>')) return true;
  if (name.startsWith('on') && name.length > 2 && name[2] >= 'A' && name[2] <= 'Z') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Return statement detection
// ---------------------------------------------------------------------------

function findReturnStatementLines(funcNode: Node): { start: number; end: number } {
  const body = getBody(funcNode);
  if (!body) {
    // Arrow function with expression body (no block)
    if (Node.isArrowFunction(funcNode)) {
      const arrowBody = funcNode.getBody();
      if (arrowBody) {
        return {
          start: arrowBody.getStartLineNumber(),
          end: arrowBody.getEndLineNumber(),
        };
      }
    }
    return { start: 0, end: 0 };
  }

  // Look for the last return statement in the body
  const statements = body.getStatements();
  for (let i = statements.length - 1; i >= 0; i--) {
    const stmt = statements[i];
    if (Node.isReturnStatement(stmt)) {
      return {
        start: stmt.getStartLineNumber(),
        end: stmt.getEndLineNumber(),
      };
    }
  }

  return { start: 0, end: 0 };
}

// ---------------------------------------------------------------------------
// Hook definition detection
// ---------------------------------------------------------------------------

function detectHookDefinitions(sf: SourceFile): string[] {
  const hookDefs: string[] = [];

  // Function declarations: function useFoo() { ... }
  for (const func of sf.getFunctions()) {
    const name = func.getName();
    if (!name || !isHookCall(name)) continue;
    hookDefs.push(name);
  }

  // Variable declarations: const useFoo = () => { ... }
  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarationList().getDeclarations()) {
      const name = decl.getName();
      if (!isHookCall(name)) continue;
      const init = decl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        hookDefs.push(name);
      }
    }
  }

  return hookDefs;
}

// ---------------------------------------------------------------------------
// Local hook body map (for classification of hooks defined in same file)
// ---------------------------------------------------------------------------

function buildLocalHookBodies(sf: SourceFile): Map<string, Node> {
  const map = new Map<string, Node>();

  for (const func of sf.getFunctions()) {
    const name = func.getName();
    if (name && isHookCall(name)) {
      map.set(name, func);
    }
  }

  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarationList().getDeclarations()) {
      const name = decl.getName();
      if (!isHookCall(name)) continue;
      const init = decl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        map.set(name, init);
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeReactFile(filePath: string): ReactInventory {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const resolvedImports = resolveImportsForFile(sf);
  const localHookBodies = buildLocalHookBodies(sf);
  const detectedComponents = detectComponents(sf);
  const hookDefinitions = detectHookDefinitions(sf);

  const components: ComponentInfo[] = detectedComponents.map(comp => {
    const hookCalls = extractHookCalls(comp.funcNode, comp.name, resolvedImports, localHookBodies);
    const useEffects = extractUseEffects(comp.funcNode, comp.name, sf);
    const props = extractProps(comp.funcNode, sf, comp.wrapperCall);
    const returnLines = findReturnStatementLines(comp.funcNode);

    return {
      name: comp.name,
      line: comp.line,
      kind: comp.kind,
      props,
      hookCalls,
      useEffects,
      returnStatementLine: returnLines.start,
      returnStatementEndLine: returnLines.end,
    };
  });

  return {
    filePath: relativePath,
    components,
    hookDefinitions,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-react-inventory.ts <file...> [--pretty]\n' +
        '\n' +
        'Analyze React components, hooks, useEffects, and props.\n' +
        '\n' +
        '  <file...>  One or more .tsx/.ts files to analyze\n' +
        '  --pretty   Format JSON output with indentation\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No file path provided. Use --help for usage.');
  }

  const results: ReactInventory[] = args.paths.map(p => analyzeReactFile(p));

  if (results.length === 1) {
    output(results[0], args.pretty);
  } else {
    output(results, args.pretty);
  }
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-react-inventory.ts') || process.argv[1].endsWith('ast-react-inventory'));

if (isDirectRun) {
  main();
}
