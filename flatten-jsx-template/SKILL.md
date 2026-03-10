---
name: flatten-jsx-template
description: Lift logic out of a component's JSX return into named intermediate variables. Replaces chained ternaries, inline transforms, IIFEs, and multi-statement handlers with named values above the return. Behavior-preserving.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/Component.tsx>
---

Flatten the JSX template of the component at `$ARGUMENTS`. This is a
behavior-preserving cleanup -- the component renders identically before and after.

## When to use this skill

Use this on components that already have correct DDAU boundaries (props-only, or
a container with proper hook absorption) but whose return statements contain
embedded logic. This skill does NOT restructure hooks, extract containers, or
change data flow. It only moves logic from the return statement to named variables
above it.

If the component has DDAU violations (hook calls that belong in a container, state
that should be props), use `refactor-react-component` instead.

## Step 1: Read and understand

Read the target file. Identify the return statement boundaries (the opening
`return (` and closing `);`). Count the lines. Read the logic inside.

## Step 2: Inventory template violations

Scan the return statement and classify every violation:

| Code | What to look for |
|------|-----------------|
| CHAINED_TERNARY | `a ? X : b ? Y : Z` -- multi-way branch |
| COMPLEX_GUARD | 3+ conditions in `&&` chain |
| INLINE_TRANSFORM | `.filter()`, `.map()`, `.reduce()` inside return |
| IIFE_IN_JSX | `{(() => { ... })()}` |
| MULTI_STMT_HANDLER | `onClick={() => { stmt1; stmt2; }}` |
| INLINE_STYLE_OBJECT | `style={{ computed }}` with dynamic values (not @react-pdf) |
| COMPLEX_CLASSNAME | className with 3+ conditions or nested ternary |

List each violation with its line number and a one-line description.

## Step 3: Plan the extraction

For each violation, determine where the logic goes:

### Chained ternaries on a discriminant (type, mode, status)

Extract a `Record` lookup map:

```tsx
// Before (in return)
{type === 'A' ? <IconA /> : type === 'B' ? <IconB /> : <IconC />}

// After (above return)
const iconByType: Record<Type, ReactNode> = {
  A: <IconA />,
  B: <IconB />,
  C: <IconC />,
};
const typeIcon = iconByType[type] ?? <IconDefault />;

// In return
{typeIcon}
```

### Chained ternaries on loading/data states

Extract named booleans:

```tsx
// Before (in return)
{loading ? <Spinner /> : !data ? <Empty /> : data.length === 0 ? <Placeholder /> : <Table />}

// After (above return)
const showLoading = loading;
const showEmpty = !loading && !data;
const showPlaceholder = !loading && data?.length === 0;
const showTable = !loading && data && data.length > 0;

// In return
{showLoading && <Spinner />}
{showEmpty && <Empty />}
{showPlaceholder && <Placeholder />}
{showTable && <Table rows={formattedRows} />}
```

### Inline transforms

Move to `useMemo` or a named `const`:

```tsx
// Before (in return)
{items.filter(i => i.active).map(i => <Row key={i.id} {...i} />)}

// After (above return)
const activeItems = useMemo(
  () => items.filter(i => i.active),
  [items],
);

// In return
{activeItems.map(item => <Row key={item.id} {...item} />)}
```

Note: a simple `.map()` with no preceding filter/sort/reduce and a short body
(single JSX element) is acceptable inline. The goal is to remove computation,
not to ban iteration.

### Multi-statement handlers

Extract to named functions:

```tsx
// Before (in return)
onClick={() => {
  setActiveTab('overview');
  setSelectedItem(null);
  sendAnalyticsEvent('tab_change');
}}

// After (above return)
const handleTabReset = () => {
  setActiveTab('overview');
  setSelectedItem(null);
  sendAnalyticsEvent('tab_change');
};

// In return
onClick={handleTabReset}
```

### IIFEs

Extract to a named variable:

```tsx
// Before (in return)
{(() => {
  const parts = description.split(/(\*\*.*?\*\*)/);
  return parts.map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
})()}

// After (above return)
const formattedDescription = useMemo(() => {
  const parts = description.split(/(\*\*.*?\*\*)/);
  return parts.map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}, [description]);

// In return
{formattedDescription}
```

### Complex classNames

Extract to a named variable or use a lookup:

```tsx
// Before (in return)
className={`px-2 py-1 ${isActive ? 'bg-blue-600 text-white' : isHovered ? 'bg-blue-100' : 'bg-gray-50'} ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}

// After (above return)
const stateClass = isActive ? 'bg-blue-600 text-white' : isHovered ? 'bg-blue-100' : 'bg-gray-50';
const interactionClass = isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';

// In return
className={`px-2 py-1 ${stateClass} ${interactionClass}`}
```

## Step 4: Apply

Rewrite the component. Rules:

- **Every extracted variable gets a name that documents the decision.** Not `temp`
  or `value` or `result`. Use `showTable`, `formattedRows`, `iconColor`,
  `activeItems`, `handleTabReset`.
- **Preserve the exact same rendering behavior.** The DOM output must be identical.
- **Order intermediate variables logically.** Group: first derived data, then
  rendering predicates, then handlers, then the return.
- **Use `useMemo` for expensive computation** (array transforms, object
  construction with many fields). For simple lookups or boolean flags, a plain
  `const` is fine.
- **Do not extract simple single-element `.map()` calls** that have no preceding
  filter/sort/reduce. `{items.map(item => <li key={item.id}>{item.name}</li>)}`
  is fine inline.
- **Do not extract single binary ternaries** that are short and clear.
  `{isOpen && <Modal />}` and `{active ? 'on' : 'off'}` are fine inline.

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the changed file. Fix any type errors. If tests
exist for this component, run them. The template flatten must not break anything.

Output a summary: violations found, what was extracted, lines before/after in the
return statement, and whether type-checking and tests passed.
