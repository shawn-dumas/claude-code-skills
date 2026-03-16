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
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getBody, detectComponents, getFilesInDirectory } from './shared';
import type { FileFilter } from './shared';
import type {
  ReactInventory,
  ComponentInfo,
  HookCall,
  UseEffectInfo,
  PropField,
  EffectObservation,
  HookObservation,
  ComponentObservation,
} from './types';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';

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
// Hook call extraction (direct function body only)
// ---------------------------------------------------------------------------

function isHookCall(name: string): boolean {
  return name.startsWith('use') && name.length > 3 && name[3] >= 'A' && name[3] <= 'Z';
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

function extractHookCalls(funcNode: Node, parentName: string): HookCall[] {
  const hooks: HookCall[] = [];
  const body = getBody(funcNode);
  if (!body) return hooks;

  // Only look at direct statements in the function body, not nested functions
  for (const stmt of body.getStatements()) {
    visitStatementForHooks(stmt, parentName, hooks);
  }

  return hooks;
}

/**
 * Extract the hook name from a call expression. Handles both direct calls
 * (useHook()) and member-call expressions (obj.useHook()). Returns null
 * if the expression is not a hook call.
 */
function extractHookName(
  callExpr: Node & { getExpression(): Node },
): { hookName: string; isMemberCall: boolean } | null {
  const expr = callExpr.getExpression();
  const directName = expr.getText();

  // Direct call: useHook()
  if (isHookCall(directName)) {
    return { hookName: directName, isMemberCall: false };
  }

  // Member call: obj.useHook()
  if (Node.isPropertyAccessExpression(expr)) {
    const propName = expr.getName();
    if (isHookCall(propName)) {
      return { hookName: propName, isMemberCall: true };
    }
  }

  return null;
}

function visitStatementForHooks(node: Node, parentName: string, hooks: HookCall[]): void {
  // Variable declaration: const [x, y] = useHook() or obj.useHook()
  if (Node.isVariableStatement(node)) {
    for (const decl of node.getDeclarationList().getDeclarations()) {
      const init = decl.getInitializer();
      if (init && Node.isCallExpression(init)) {
        const hookInfo = extractHookName(init);
        if (hookInfo) {
          hooks.push({
            name: hookInfo.hookName,
            line: init.getStartLineNumber(),
            column: init.getSourceFile().getLineAndColumnAtPos(init.getStart()).column,
            parentFunction: parentName,
            destructuredNames: getDestructuredNames(decl),
          });
        }
      }
    }
    return;
  }

  // Expression statement: useHook() or obj.useHook() (no assignment)
  if (Node.isExpressionStatement(node)) {
    const expr = node.getExpression();
    if (Node.isCallExpression(expr)) {
      const hookInfo = extractHookName(expr);
      if (hookInfo) {
        hooks.push({
          name: hookInfo.hookName,
          line: expr.getStartLineNumber(),
          column: expr.getSourceFile().getLineAndColumnAtPos(expr.getStart()).column,
          parentFunction: parentName,
          destructuredNames: [],
        });
      }
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Hook observations (semantic layering approach)
// ---------------------------------------------------------------------------

/**
 * Extract structural observations for hook calls. These are pure facts:
 * - hookName
 * - importSource (resolved path)
 * - isReactBuiltin
 * - destructuredNames
 *
 * NO classification is emitted -- that is the interpreter's job.
 */
function extractHookObservations(
  funcNode: Node,
  parentName: string,
  filePath: string,
  resolvedImports: ResolvedImport[],
): HookObservation[] {
  const observations: HookObservation[] = [];
  const body = getBody(funcNode);
  if (!body) return observations;

  for (const stmt of body.getStatements()) {
    extractHookObservationsFromStatement(stmt, parentName, filePath, resolvedImports, observations);
  }

  return observations;
}

function extractHookObservationsFromStatement(
  node: Node,
  parentName: string,
  filePath: string,
  resolvedImports: ResolvedImport[],
  observations: HookObservation[],
): void {
  // Variable declaration: const [x, y] = useHook() or obj.useHook()
  if (Node.isVariableStatement(node)) {
    for (const decl of node.getDeclarationList().getDeclarations()) {
      const init = decl.getInitializer();
      if (init && Node.isCallExpression(init)) {
        const hookInfo = extractHookName(init);
        if (hookInfo) {
          const imp = hookInfo.isMemberCall ? undefined : resolvedImports.find(i => i.specifier === hookInfo.hookName);
          const importSource = imp ? (imp.sourcePath ?? imp.rawSource) : undefined;
          const isReactBuiltin = astConfig.react.builtinHooks.has(hookInfo.hookName);

          observations.push({
            kind: 'HOOK_CALL',
            file: filePath,
            line: init.getStartLineNumber(),
            column: init.getSourceFile().getLineAndColumnAtPos(init.getStart()).column,
            evidence: {
              hookName: hookInfo.hookName,
              importSource,
              destructuredNames: getDestructuredNames(decl),
              parentFunction: parentName,
              isReactBuiltin,
              isMemberCall: hookInfo.isMemberCall || undefined,
            },
          });
        }
      }
    }
    return;
  }

  // Expression statement: useHook() or obj.useHook() (no assignment)
  if (Node.isExpressionStatement(node)) {
    const expr = node.getExpression();
    if (Node.isCallExpression(expr)) {
      const hookInfo = extractHookName(expr);
      if (hookInfo) {
        const imp = hookInfo.isMemberCall ? undefined : resolvedImports.find(i => i.specifier === hookInfo.hookName);
        const importSource = imp ? (imp.sourcePath ?? imp.rawSource) : undefined;
        const isReactBuiltin = astConfig.react.builtinHooks.has(hookInfo.hookName);

        observations.push({
          kind: 'HOOK_CALL',
          file: filePath,
          line: expr.getStartLineNumber(),
          column: expr.getSourceFile().getLineAndColumnAtPos(expr.getStart()).column,
          evidence: {
            hookName: hookInfo.hookName,
            importSource,
            destructuredNames: [],
            parentFunction: parentName,
            isReactBuiltin,
            isMemberCall: hookInfo.isMemberCall || undefined,
          },
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
// Ref DOM type resolution
// ---------------------------------------------------------------------------

const DOM_TYPE_PATTERN = /^(HTML\w*Element|SVGElement|SVG\w*Element|Element)$/;

/**
 * Common DOM properties and methods accessed on ref.current in React effects.
 * Used as a fallback when useRef has no generic type parameter -- if the
 * property accessed on ref.current is in this set, the ref is likely a DOM ref.
 */
const DOM_PROPERTY_ALLOWLIST = new Set([
  'scrollTop',
  'scrollLeft',
  'scrollHeight',
  'scrollWidth',
  'style',
  'classList',
  'className',
  'focus',
  'blur',
  'click',
  'select',
  'offsetHeight',
  'offsetWidth',
  'offsetTop',
  'offsetLeft',
  'getBoundingClientRect',
  'addEventListener',
  'removeEventListener',
  'innerHTML',
  'textContent',
  'value',
]);

/**
 * Build a map from ref variable name -> isDomRef for all useRef calls
 * in a function body. Returns undefined for the value when the useRef
 * call has no generic parameter (ambiguous).
 */
function buildRefDomTypeMap(funcNode: Node): Map<string, boolean | undefined> {
  const refMap = new Map<string, boolean | undefined>();
  const body = getBody(funcNode);
  if (!body) return refMap;

  for (const stmt of body.getStatements()) {
    if (!Node.isVariableStatement(stmt)) continue;
    for (const decl of stmt.getDeclarationList().getDeclarations()) {
      const init = decl.getInitializer();
      if (!init || !Node.isCallExpression(init)) continue;
      const callName = init.getExpression().getText();
      if (callName !== 'useRef') continue;

      const refName = decl.getName();
      const typeArgs = init.getTypeArguments();

      if (typeArgs.length === 0) {
        // No generic parameter -- ambiguous (could be DOM or value ref)
        refMap.set(refName, undefined);
        continue;
      }

      const typeArgNode = typeArgs[0];
      const typeText = typeArgNode.getText();

      // Direct match: useRef<HTMLDivElement>, useRef<SVGElement>, etc.
      if (DOM_TYPE_PATTERN.test(typeText)) {
        refMap.set(refName, true);
        continue;
      }

      // Use the type checker to resolve the type and check base types.
      // This handles union types like useRef<HTMLDivElement | null> or
      // type aliases that resolve to DOM element types.
      try {
        const typeArgType = typeArgNode.getType();
        // For union types (e.g., HTMLDivElement | null), check non-null parts
        const typesToCheck = typeArgType.isUnion() ? typeArgType.getUnionTypes() : [typeArgType];
        let hasDomType = false;
        let hasNonNullType = false;

        for (const t of typesToCheck) {
          const text = t.getText();
          // Skip null/undefined in union
          if (text === 'null' || text === 'undefined') continue;
          hasNonNullType = true;

          if (DOM_TYPE_PATTERN.test(text)) {
            hasDomType = true;
            break;
          }

          // Check base types for subtypes
          const baseTypes = t.getBaseTypes();
          if (baseTypes.some(bt => DOM_TYPE_PATTERN.test(bt.getSymbol()?.getName() ?? ''))) {
            hasDomType = true;
            break;
          }
        }

        refMap.set(refName, hasNonNullType ? hasDomType : undefined);
      } catch {
        // Type resolution failed -- treat as ambiguous
        refMap.set(refName, undefined);
      }
    }
  }

  // Allowlist fallback: for refs with ambiguous type (undefined), scan
  // the function body for ref.current.<property> accesses. If any accessed
  // property is in DOM_PROPERTY_ALLOWLIST, infer isDomRef: true.
  const ambiguousRefs = [...refMap.entries()].filter(([, v]) => v === undefined).map(([k]) => k);
  if (ambiguousRefs.length > 0) {
    body.forEachDescendant(node => {
      if (!Node.isPropertyAccessExpression(node)) return;
      const inner = node.getExpression();
      if (!Node.isPropertyAccessExpression(inner)) return;
      if (inner.getName() !== 'current') return;
      const refName = inner.getExpression().getText();
      if (!ambiguousRefs.includes(refName)) return;
      if (refMap.get(refName) === true) return; // already resolved
      const prop = node.getName();
      if (DOM_PROPERTY_ALLOWLIST.has(prop)) {
        refMap.set(refName, true);
      }
    });
  }

  return refMap;
}

// ---------------------------------------------------------------------------
// Effect observations (new semantic layering approach)
// ---------------------------------------------------------------------------

/**
 * Extract structural observations from a useEffect/useLayoutEffect call.
 * These are pure facts with no classifications -- the interpreter layer
 * adds judgments later.
 */
function extractEffectObservations(
  expr: Node & { getArguments(): Node[]; getExpression(): Node },
  parentName: string,
  filePath: string,
  knownSetters: Set<string>,
  propNames: Set<string>,
  contextBindings: Map<string, string>,
  refDomTypeMap: Map<string, boolean | undefined>,
): EffectObservation[] {
  const observations: EffectObservation[] = [];
  const effectLine = expr.getStartLineNumber();
  const hookName = expr.getExpression().getText();
  const args = expr.getArguments();
  if (args.length === 0) return observations;

  const callback = args[0];
  const depArg = args.length > 1 ? args[1] : null;

  // EFFECT_LOCATION: one per effect
  const depArray = depArg && Node.isArrayLiteralExpression(depArg) ? depArg.getElements().map(el => el.getText()) : [];
  observations.push({
    kind: 'EFFECT_LOCATION',
    file: filePath,
    line: effectLine,
    evidence: {
      effectLine,
      parentFunction: parentName,
      depArray,
      identifier: hookName,
    },
  });

  // EFFECT_DEP_ENTRY: one per dependency
  if (depArg && Node.isArrayLiteralExpression(depArg)) {
    for (const el of depArg.getElements()) {
      observations.push({
        kind: 'EFFECT_DEP_ENTRY',
        file: filePath,
        line: depArg.getStartLineNumber(),
        evidence: {
          effectLine,
          identifier: el.getText(),
        },
      });
    }
  }

  // EFFECT_CLEANUP_PRESENT
  if (analyzeCleanup(callback)) {
    observations.push({
      kind: 'EFFECT_CLEANUP_PRESENT',
      file: filePath,
      line: effectLine,
      evidence: { effectLine },
    });
  }

  // Build dep set for EFFECT_BODY_DEP_CALL detection
  const depSet = new Set(depArray);

  // Walk the callback body for observations
  callback.forEachDescendant(node => {
    const line = node.getStartLineNumber();

    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();

      // Direct function calls
      if (Node.isIdentifier(callee)) {
        const name = callee.getText();

        // EFFECT_BODY_DEP_CALL: a dep array identifier used as a callee.
        // Emitted for deps not already covered by setter/fetch/timer/nav observations.
        if (
          depSet.has(name) &&
          !knownSetters.has(name) &&
          !astConfig.effects.dispatchIdentifiers.has(name) &&
          !astConfig.effects.fetchFunctions.has(name) &&
          !astConfig.effects.timerFunctions.has(name) &&
          !astConfig.effects.navigateFunctions.has(name)
        ) {
          observations.push({
            kind: 'EFFECT_BODY_DEP_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: name },
          });
        }

        // EFFECT_STATE_SETTER_CALL
        if (knownSetters.has(name)) {
          observations.push({
            kind: 'EFFECT_STATE_SETTER_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: name },
          });
        }

        // dispatch also counts as state setter
        if (astConfig.effects.dispatchIdentifiers.has(name)) {
          observations.push({
            kind: 'EFFECT_STATE_SETTER_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: name },
          });
        }

        // EFFECT_FETCH_CALL
        if (astConfig.effects.fetchFunctions.has(name)) {
          observations.push({
            kind: 'EFFECT_FETCH_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: name },
          });
        }

        // EFFECT_TIMER_CALL
        if (astConfig.effects.timerFunctions.has(name)) {
          observations.push({
            kind: 'EFFECT_TIMER_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: name },
          });
        }

        // EFFECT_NAVIGATION_CALL (direct function calls like navigate())
        if (astConfig.effects.navigateFunctions.has(name)) {
          observations.push({
            kind: 'EFFECT_NAVIGATION_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: name },
          });
        }
      }

      // Property access calls: obj.method()
      if (Node.isPropertyAccessExpression(callee)) {
        const obj = callee.getExpression().getText();
        const method = callee.getName();

        // EFFECT_NAVIGATION_CALL (router.push(), router.replace())
        if (astConfig.effects.routerObjectNames.includes(obj) && astConfig.effects.routerNavMethods.has(method)) {
          observations.push({
            kind: 'EFFECT_NAVIGATION_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: obj, method, targetObject: obj },
          });
        }

        // EFFECT_STORAGE_CALL (localStorage.getItem(), etc.)
        if (astConfig.effects.storageObjects.has(obj)) {
          observations.push({
            kind: 'EFFECT_STORAGE_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: obj, method, targetObject: obj },
          });
        }

        // EFFECT_TOAST_CALL (toast.success(), etc.)
        if (astConfig.effects.toastObjectNames.includes(obj)) {
          observations.push({
            kind: 'EFFECT_TOAST_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: obj, method, targetObject: obj },
          });
        }

        // EFFECT_FETCH_CALL (axios.get(), axios.post(), etc.)
        if (astConfig.effects.axiosIdentifiers.includes(obj)) {
          observations.push({
            kind: 'EFFECT_FETCH_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: obj, method, targetObject: obj },
          });
        }

        // EFFECT_REF_TOUCH (.current access)
        if (method === 'current') {
          const isDomRef = refDomTypeMap.get(obj);
          observations.push({
            kind: 'EFFECT_REF_TOUCH',
            file: filePath,
            line,
            evidence: { effectLine, identifier: obj, ...(isDomRef !== undefined && { isDomRef }) },
          });
        }

        // EFFECT_DOM_API (document.*, window.addEventListener, etc.)
        if (obj === 'document' || obj === 'window') {
          observations.push({
            kind: 'EFFECT_DOM_API',
            file: filePath,
            line,
            evidence: { effectLine, identifier: obj, method, targetObject: obj },
          });
        }
      }
    }

    // EFFECT_ASYNC_CALL: async callback or .then() chain
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      if (node.isAsync()) {
        observations.push({
          kind: 'EFFECT_ASYNC_CALL',
          file: filePath,
          line,
          evidence: { effectLine },
        });
      }
    }

    if (Node.isCallExpression(node)) {
      const callee = node.getExpression();
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'then') {
        observations.push({
          kind: 'EFFECT_ASYNC_CALL',
          file: filePath,
          line,
          evidence: { effectLine },
        });
      }
    }

    // EFFECT_PROP_READ: identifier that matches a prop name
    if (Node.isIdentifier(node)) {
      const name = node.getText();

      if (propNames.has(name)) {
        // Check that this is a read, not a declaration
        const parent = node.getParent();
        if (!Node.isVariableDeclaration(parent) && !Node.isBindingElement(parent)) {
          observations.push({
            kind: 'EFFECT_PROP_READ',
            file: filePath,
            line,
            evidence: { effectLine, identifier: name },
          });
        }
      }

      // EFFECT_CONTEXT_READ: identifier from context hook destructuring
      const sourceHook = contextBindings.get(name);
      if (sourceHook) {
        const parent = node.getParent();
        if (!Node.isVariableDeclaration(parent) && !Node.isBindingElement(parent)) {
          observations.push({
            kind: 'EFFECT_CONTEXT_READ',
            file: filePath,
            line,
            evidence: { effectLine, identifier: name, targetObject: sourceHook },
          });
        }
      }

      // EFFECT_STORAGE_CALL (bare identifier references like readStorage, writeStorage)
      if (astConfig.effects.storageIdentifiers.has(name)) {
        // Only count if it's being called, not just referenced
        const parent = node.getParent();
        if (Node.isCallExpression(parent) && parent.getExpression() === node) {
          observations.push({
            kind: 'EFFECT_STORAGE_CALL',
            file: filePath,
            line,
            evidence: { effectLine, identifier: name },
          });
        }
      }
    }

    // EFFECT_REF_TOUCH: .current property access (not just method calls)
    if (Node.isPropertyAccessExpression(node)) {
      if (node.getName() === 'current') {
        const obj = node.getExpression().getText();
        // Avoid duplicating with the call expression case
        const parent = node.getParent();
        if (!Node.isCallExpression(parent)) {
          const isDomRef = refDomTypeMap.get(obj);
          observations.push({
            kind: 'EFFECT_REF_TOUCH',
            file: filePath,
            line,
            evidence: { effectLine, identifier: obj, ...(isDomRef !== undefined && { isDomRef }) },
          });
        }
      }
    }
  });

  return observations;
}

/**
 * Collect prop names from component's first parameter.
 */
function collectPropNames(funcNode: Node): Set<string> {
  const propNames = new Set<string>();
  const firstParam = getFirstParam(funcNode);
  if (!firstParam) return propNames;

  const nameNode = firstParam.getNameNode();
  if (Node.isObjectBindingPattern(nameNode)) {
    for (const el of nameNode.getElements()) {
      if (Node.isBindingElement(el)) {
        propNames.add(el.getName());
      }
    }
  }

  return propNames;
}

/**
 * Collect bindings from context hooks for EFFECT_CONTEXT_READ detection.
 * Returns a map from identifier name to the source hook name.
 */
function collectContextBindings(funcNode: Node): Map<string, string> {
  const bindings = new Map<string, string>();
  const body = getBody(funcNode);
  if (!body) return bindings;

  for (const stmt of body.getStatements()) {
    if (!Node.isVariableStatement(stmt)) continue;
    for (const decl of stmt.getDeclarationList().getDeclarations()) {
      const init = decl.getInitializer();
      if (!init || !Node.isCallExpression(init)) continue;

      const hookName = init.getExpression().getText();
      // Check if it's a known context hook
      if (!astConfig.hooks.knownContextHooks.has(hookName) && hookName !== 'useContext') continue;

      const nameNode = decl.getNameNode();
      if (Node.isObjectBindingPattern(nameNode)) {
        for (const el of nameNode.getElements()) {
          if (Node.isBindingElement(el)) {
            bindings.set(el.getName(), hookName);
          }
        }
      } else if (Node.isIdentifier(nameNode)) {
        bindings.set(nameNode.getText(), hookName);
      }
    }
  }

  return bindings;
}

/**
 * Extract effect observations from all useEffect/useLayoutEffect calls in a component.
 */
function extractAllEffectObservations(funcNode: Node, parentName: string, filePath: string): EffectObservation[] {
  const body = getBody(funcNode);
  if (!body) return [];

  const stateSetters = collectStateSetters(body);
  const propNames = collectPropNames(funcNode);
  const contextBindings = collectContextBindings(funcNode);
  const refDomTypeMap = buildRefDomTypeMap(funcNode);
  const observations: EffectObservation[] = [];

  for (const stmt of body.getStatements()) {
    if (!Node.isExpressionStatement(stmt)) continue;
    const expr = stmt.getExpression();
    if (!Node.isCallExpression(expr)) continue;
    if (!astConfig.effects.effectHookNames.has(expr.getExpression().getText())) continue;

    observations.push(
      ...extractEffectObservations(expr, parentName, filePath, stateSetters, propNames, contextBindings, refDomTypeMap),
    );
  }

  return observations;
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
// Component observations (semantic layering approach)
// ---------------------------------------------------------------------------

/**
 * Extract structural observations for components and props.
 * - COMPONENT_DECLARATION: one per component
 * - PROP_FIELD: one per prop
 */
function extractComponentObservations(
  comp: { name: string; kind: 'function' | 'arrow' | 'memo' | 'forwardRef'; line: number },
  props: PropField[],
  filePath: string,
): ComponentObservation[] {
  const observations: ComponentObservation[] = [];

  // COMPONENT_DECLARATION observation
  observations.push({
    kind: 'COMPONENT_DECLARATION',
    file: filePath,
    line: comp.line,
    evidence: {
      componentName: comp.name,
      kind: comp.kind,
    },
  });

  // PROP_FIELD observations
  for (const prop of props) {
    observations.push({
      kind: 'PROP_FIELD',
      file: filePath,
      line: comp.line, // Props are associated with component line
      evidence: {
        componentName: comp.name,
        propName: prop.name,
        propType: prop.type,
        isOptional: prop.optional,
        hasDefault: prop.hasDefault,
        isCallback: prop.isCallback,
      },
    });
  }

  return observations;
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
// Public API
// ---------------------------------------------------------------------------

export function analyzeReactFile(filePath: string): ReactInventory {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const resolvedImports = resolveImportsForFile(sf);
  const detectedComponents = detectComponents(sf);
  const hookDefinitions = detectHookDefinitions(sf);

  // Collect file-level observations
  const allHookObservations: HookObservation[] = [];
  const allComponentObservations: ComponentObservation[] = [];

  const components: ComponentInfo[] = detectedComponents.map(comp => {
    const hookCalls = extractHookCalls(comp.funcNode, comp.name);
    const useEffects = extractUseEffects(comp.funcNode, comp.name, sf);
    const effectObservations = extractAllEffectObservations(comp.funcNode, comp.name, relativePath);
    const props = extractProps(comp.funcNode, sf, comp.wrapperCall);
    const returnLines = findReturnStatementLines(comp.funcNode);

    // Extract hook observations for this component
    const hookObs = extractHookObservations(comp.funcNode, comp.name, relativePath, resolvedImports);
    allHookObservations.push(...hookObs);

    // Extract component observations (COMPONENT_DECLARATION + PROP_FIELD)
    const compObs = extractComponentObservations(
      { name: comp.name, kind: comp.kind, line: comp.line },
      props,
      relativePath,
    );
    allComponentObservations.push(...compObs);

    return {
      name: comp.name,
      line: comp.line,
      kind: comp.kind,
      props,
      hookCalls,
      useEffects,
      effectObservations,
      returnStatementLine: returnLines.start,
      returnStatementEndLine: returnLines.end,
    };
  });

  return {
    filePath: relativePath,
    components,
    hookDefinitions,
    hookObservations: allHookObservations,
    componentObservations: allComponentObservations,
  };
}

export function analyzeReactFileDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): ReactInventory[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: ReactInventory[] = [];
  for (const fp of filePaths) {
    const analysis = cached('react-inventory', fp, () => analyzeReactFile(fp), options);
    // Include files with any components or hook definitions
    if (analysis.components.length > 0 || analysis.hookDefinitions.length > 0) {
      results.push(analysis);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-react-inventory.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '\n' +
        'Analyze React components, hooks, useEffects, and props.\n' +
        '\n' +
        '  <path...>     One or more .tsx/.ts files or directories to analyze\n' +
        '  --pretty      Format JSON output with indentation\n' +
        '  --no-cache    Bypass cache and recompute (also refreshes cache)\n' +
        '  --test-files  Scan test files instead of production files\n' +
        '  --kind        Filter observations to a specific kind\n' +
        '  --count       Output observation kind counts instead of full data\n',
    );
    process.exit(0);
  }

  const noCache = args.flags.has('no-cache');
  const testFiles = args.flags.has('test-files');

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const allResults: ReactInventory[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(...analyzeReactFileDirectory(targetPath, { noCache, filter: testFiles ? 'test' : 'production' }));
    } else {
      const result = cached('react-inventory', absolute, () => analyzeReactFile(absolute), { noCache });
      allResults.push(result);
    }
  }

  const cacheStats = getCacheStats();
  if (cacheStats.hits > 0 || cacheStats.misses > 0) {
    process.stderr.write(`Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses\n`);
  }

  const result = allResults.length === 1 ? allResults[0] : allResults;
  outputFiltered(result, args.pretty, {
    kind: args.options.kind,
    count: args.flags.has('count'),
  });
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-react-inventory.ts') || process.argv[1].endsWith('ast-react-inventory'));

if (isDirectRun) {
  main();
}
