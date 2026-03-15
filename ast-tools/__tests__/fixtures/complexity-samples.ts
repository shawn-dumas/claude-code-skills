// Test fixture for ast-complexity analysis
// Do not modify line numbers without updating the test expectations

// Line 5: simple function
export function add(a: number, b: number): number {
  return a + b;
}

// Line 10: if/else function
export function checkPositive(n: number): string {
  if (n > 0) {
    return 'positive';
  } else {
    return 'non-positive';
  }
}

// Line 18: switch function with 3 cases + default
export function dayType(day: string): string {
  switch (day) {
    case 'Monday':
      return 'start';
    case 'Wednesday':
      return 'mid';
    case 'Friday':
      return 'end';
    default:
      return 'other';
  }
}

// Line 31: nested control flow (if > for > if)
export function processItems(items: Array<{ active: boolean; values: number[] }>): number {
  let total = 0;
  if (items.length > 0) {
    for (const item of items) {
      if (item.active) {
        total += item.values.length;
      }
    }
  }
  return total;
}

// Line 43: logical operators
export function checkConditions(a: boolean, b: boolean, c: boolean): boolean {
  if ((a && b) || c) {
    return true;
  }
  return false;
}

// Line 51: ternary
export function ternaryExample(a: boolean): string {
  const x = a ? 'yes' : 'no';
  return x;
}

// Line 56: try/catch
export function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// Line 63: inline callback -- if inside forEach contributes to enclosing
export function processWithCallback(items: number[]): number[] {
  const results: number[] = [];
  items.forEach(item => {
    if (item > 0) {
      results.push(item * 2);
    }
  });
  return results;
}

// Line 73: multiple functions for file total test
export function helperA(x: number): number {
  if (x > 0) {
    return x;
  }
  return -x;
}

export function helperB(x: number, y: number): number {
  return x > y ? x : y;
}

// Line 84: deeply nested with while and do-while
export function deepNesting(data: number[][]): number {
  let count = 0;
  for (const row of data) {
    if (row.length > 0) {
      for (const val of row) {
        if (val > 0) {
          count += val;
        }
      }
    }
  }
  return count;
}

// Line 98: nullish coalesce and optional chain (optional chain should NOT count)
export function withNullish(obj: { a?: { b?: number } } | null): number {
  const val = obj?.a?.b ?? 0;
  return val;
}

// Line 103: for-in loop
export function countKeys(obj: Record<string, unknown>): number {
  let count = 0;
  for (const _key in obj) {
    count++;
  }
  return count;
}

// Line 111: class with methods
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  conditionalAdd(a: number, b: number, shouldDouble: boolean): number {
    if (shouldDouble) {
      return (a + b) * 2;
    }
    return a + b;
  }
}
