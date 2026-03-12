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
import { isPascalCase, containsJsx, getBody } from './shared';
import type { ReactInventory, ComponentInfo, HookCall, UseEffectInfo, PropField } from './types';
import { MAY_REMAIN_HOOKS, SCOPED_HOOK_PATTERN, KNOWN_CONTEXT_HOOKS, REACT_BUILTIN_HOOKS } from './types';

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

function classifyHook(
  hookName: string,
  resolvedImports: ResolvedImport[],
  localHookBodies: Map<string, Node>,
): HookClassification {
  // 1. may-remain (ambient UI hooks)
  if ((MAY_REMAIN_HOOKS as readonly string[]).includes(hookName)) {
    return 'may-remain';
  }
  if (SCOPED_HOOK_PATTERN.test(hookName)) {
    return 'may-remain';
  }

  // 2. React built-in state-utility
  if ((REACT_BUILTIN_HOOKS as readonly string[]).includes(hookName)) {
    return 'state-utility';
  }

  // 3. Check import source path
  const imp = resolvedImports.find(i => i.specifier === hookName);

  if (imp) {
    const src = imp.sourcePath ?? imp.rawSource;

    // service: from services/hooks/ or react-query package
    if (src.includes('services/hooks') || src.includes('@tanstack/react-query')) {
      return 'service';
    }

    // context: from providers/ or context/
    if (src.includes('providers/') || src.includes('context/')) {
      return 'context';
    }

    // dom-utility: from shared/hooks/
    if (src.includes('shared/hooks')) {
      return 'dom-utility';
    }

    // Known service hook packages
    if (hookName === 'useQuery' || hookName === 'useMutation' || hookName === 'useInfiniteQuery') {
      return 'service';
    }
  }

  // 4. Known context hooks fallback (by name)
  if ((KNOWN_CONTEXT_HOOKS as readonly string[]).includes(hookName)) {
    return 'context';
  }

  // 5. Check locally-defined hooks
  const localBody = localHookBodies.get(hookName);
  if (localBody) {
    const bodyText = localBody.getText();
    if (bodyText.includes('useContext')) return 'context';
    if (bodyText.includes('useQuery') || bodyText.includes('useMutation') || bodyText.includes('useInfiniteQuery')) {
      return 'service';
    }
  }

  // 6. Name-based heuristics for unresolved imports
  if (hookName === 'useQuery' || hookName === 'useMutation' || hookName === 'useInfiniteQuery') {
    return 'service';
  }
  if (hookName === 'useContext') {
    return 'context';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Hook call extraction (direct function body only)
// ---------------------------------------------------------------------------

function isHookCall(name: string): boolean {
  return /^use[A-Z]/.test(name) || name === 'useId';
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

function extractUseEffects(funcNode: Node, parentName: string, sf: SourceFile): UseEffectInfo[] {
  const effects: UseEffectInfo[] = [];
  const body = getBody(funcNode);
  if (!body) return effects;

  // Collect useState setters for setState detection
  const stateSetters = new Set<string>();
  for (const stmt of body.getStatements()) {
    if (Node.isVariableStatement(stmt)) {
      for (const decl of stmt.getDeclarationList().getDeclarations()) {
        const init = decl.getInitializer();
        if (init && Node.isCallExpression(init)) {
          const callName = init.getExpression().getText();
          if (callName === 'useState') {
            const nameNode = decl.getNameNode();
            if (Node.isArrayBindingPattern(nameNode)) {
              const elements = nameNode.getElements();
              if (elements.length >= 2 && Node.isBindingElement(elements[1])) {
                stateSetters.add(elements[1].getName());
              }
            }
          }
        }
      }
    }
  }

  // Find useEffect calls in direct body statements
  for (const stmt of body.getStatements()) {
    if (Node.isExpressionStatement(stmt)) {
      const expr = stmt.getExpression();
      if (Node.isCallExpression(expr)) {
        const callName = expr.getExpression().getText();
        if (callName === 'useEffect' || callName === 'useLayoutEffect') {
          const args = expr.getArguments();
          if (args.length === 0) continue;

          const callback = args[0];
          const depArg = args.length > 1 ? args[1] : null;

          // Extract dependency array
          let depArray: string[] | 'none' = 'none';
          if (depArg && Node.isArrayLiteralExpression(depArg)) {
            depArray = depArg.getElements().map(el => el.getText());
          }

          // Analyze cleanup
          const hasCleanup = analyzeCleanup(callback);

          // Analyze body
          const bodyAnalysis = analyzeEffectBody(callback, stateSetters);

          effects.push({
            line: expr.getStartLineNumber(),
            parentFunction: parentName,
            depArray,
            hasCleanup,
            bodyAnalysis,
          });
        }
      }
    }
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

function analyzeEffectBody(callback: Node, knownSetters: Set<string>): UseEffectInfo['bodyAnalysis'] {
  const result = {
    callsSetState: false,
    stateSetters: [] as string[],
    callsFetch: false,
    callsNavigation: false,
    callsStorage: false,
    callsToast: false,
    hasTimers: false,
  };

  const bodyText = callback.getText();

  // State setters -- use word-boundary regex to avoid false positives
  // (e.g. 'setCount' matching 'resetCount(' via substring includes)
  for (const setter of knownSetters) {
    const setterPattern = new RegExp(`\\b${setter}\\s*\\(`);
    if (setterPattern.test(bodyText)) {
      result.stateSetters.push(setter);
      result.callsSetState = true;
    }
  }
  // Also check for dispatch
  if (/\bdispatch\s*\(/.test(bodyText)) {
    result.callsSetState = true;
    if (!result.stateSetters.includes('dispatch')) {
      result.stateSetters.push('dispatch');
    }
  }

  // Fetch calls
  if (/\bfetch\s*\(/.test(bodyText) || /\bfetchApi\s*\(/.test(bodyText) || /\baxios\b/.test(bodyText)) {
    result.callsFetch = true;
  }

  // Navigation
  if (/\brouter\.push\b/.test(bodyText) || /\brouter\.replace\b/.test(bodyText) || /\bnavigate\s*\(/.test(bodyText)) {
    result.callsNavigation = true;
  }

  // Storage
  if (
    /\blocalStorage\b/.test(bodyText) ||
    /\bsessionStorage\b/.test(bodyText) ||
    /\breadStorage\b/.test(bodyText) ||
    /\bwriteStorage\b/.test(bodyText) ||
    /\bremoveStorage\b/.test(bodyText)
  ) {
    result.callsStorage = true;
  }

  // Toasts
  if (/\btoast\w*\s*\(/.test(bodyText)) {
    result.callsToast = true;
  }

  // Timers
  if (
    /\bsetTimeout\s*\(/.test(bodyText) ||
    /\bsetInterval\s*\(/.test(bodyText) ||
    /\brequestAnimationFrame\s*\(/.test(bodyText)
  ) {
    result.hasTimers = true;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Props extraction
// ---------------------------------------------------------------------------

function extractProps(funcNode: Node, sf: SourceFile, wrapperCall: Node | null): PropField[] {
  let params: ParameterDeclaration[] = [];

  if (Node.isFunctionDeclaration(funcNode)) {
    params = funcNode.getParameters();
  } else if (Node.isArrowFunction(funcNode) || Node.isFunctionExpression(funcNode)) {
    params = funcNode.getParameters();
  }

  if (params.length === 0) return [];

  const firstParam = params[0];
  const nameNode = firstParam.getNameNode();

  // Only process destructured props -- single-name params (like 'props')
  // are handled differently based on their type annotation
  if (Node.isObjectBindingPattern(nameNode)) {
    const fields = extractPropsFromObjectBinding(nameNode, firstParam, sf);
    // If we got fields with unknown types and there's a wrapper call, try the generic
    if (fields.length > 0 && fields.every(f => f.type === 'unknown') && wrapperCall) {
      const genericFields = extractPropsFromWrapperGeneric(wrapperCall, sf);
      if (genericFields.length > 0) {
        // Merge: use generic fields for type info, binding fields for hasDefault
        const defaultNames = new Set(fields.filter(f => f.hasDefault).map(f => f.name));
        for (const gf of genericFields) {
          if (defaultNames.has(gf.name)) gf.hasDefault = true;
        }
        return genericFields;
      }
    }
    return fields;
  }

  // For non-destructured params, try to extract from type annotation
  const typeNode = firstParam.getTypeNode();
  if (typeNode) {
    return extractPropsFromTypeNode(typeNode, sf, firstParam);
  }

  // Fallback: try wrapper call generic
  if (wrapperCall) {
    return extractPropsFromWrapperGeneric(wrapperCall, sf);
  }

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
  if (/^on[A-Z]/.test(name)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Component detection
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

interface DetectedComponent {
  name: string;
  line: number;
  kind: ComponentInfo['kind'];
  funcNode: Node;
  /** For memo/forwardRef, the wrapping CallExpression -- used for type arg extraction */
  wrapperCall: Node | null;
}

function detectComponents(sf: SourceFile): DetectedComponent[] {
  const components: DetectedComponent[] = [];

  // 1. Function declarations: export function Foo(...) { ... }
  for (const func of sf.getFunctions()) {
    const name = func.getName();
    if (!name || !isPascalCase(name)) continue;
    if (containsJsx(func)) {
      components.push({ name, line: func.getStartLineNumber(), kind: 'function', funcNode: func, wrapperCall: null });
    }
  }

  // 2. Variable declarations: export const Foo = ...
  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarationList().getDeclarations()) {
      const name = decl.getName();
      if (!isPascalCase(name)) continue;

      const init = decl.getInitializer();
      if (!init) continue;

      // Arrow function: const Foo = () => ...
      if (Node.isArrowFunction(init)) {
        if (containsJsx(init)) {
          components.push({ name, line: decl.getStartLineNumber(), kind: 'arrow', funcNode: init, wrapperCall: null });
        }
        continue;
      }

      // Function expression: const Foo = function() { ... }
      if (Node.isFunctionExpression(init)) {
        if (containsJsx(init)) {
          components.push({ name, line: decl.getStartLineNumber(), kind: 'arrow', funcNode: init, wrapperCall: null });
        }
        continue;
      }

      // memo(): const Foo = memo(function Foo(...) { ... }) or memo((...) => ...)
      if (Node.isCallExpression(init)) {
        const callee = init.getExpression().getText();

        if (callee === 'memo' || callee === 'React.memo') {
          const args = init.getArguments();
          if (args.length > 0) {
            const inner = args[0];
            if ((Node.isArrowFunction(inner) || Node.isFunctionExpression(inner)) && containsJsx(inner)) {
              components.push({
                name,
                line: decl.getStartLineNumber(),
                kind: 'memo',
                funcNode: inner,
                wrapperCall: init,
              });
            }
          }
          continue;
        }

        // forwardRef(): const Foo = forwardRef(function Foo(...) { ... })
        if (callee === 'forwardRef' || callee === 'React.forwardRef') {
          const args = init.getArguments();
          if (args.length > 0) {
            const inner = args[0];
            if ((Node.isArrowFunction(inner) || Node.isFunctionExpression(inner)) && containsJsx(inner)) {
              components.push({
                name,
                line: decl.getStartLineNumber(),
                kind: 'forwardRef',
                funcNode: inner,
                wrapperCall: init,
              });
            }
          }
          continue;
        }
      }
    }
  }

  // 3. Non-exported inner function declarations (PascalCase, returns JSX)
  sf.forEachDescendant(node => {
    if (!Node.isFunctionDeclaration(node)) return;
    const name = node.getName();
    if (!name || !isPascalCase(name)) return;
    // Skip if already detected
    if (components.some(c => c.name === name && c.line === node.getStartLineNumber())) return;
    if (containsJsx(node)) {
      components.push({ name, line: node.getStartLineNumber(), kind: 'function', funcNode: node, wrapperCall: null });
    }
  });

  return components;
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
