// Fixture for ast-complexity: constructor, get/set accessors, nested standalone functions
// These exercise code paths not covered by complexity-samples.ts

// Class with constructor and get/set accessors
export class TemperatureConverter {
  private _celsius: number;

  constructor(celsius: number) {
    if (celsius < -273.15) {
      throw new RangeError('Below absolute zero');
    }
    this._celsius = celsius;
  }

  get fahrenheit(): number {
    return this._celsius * 1.8 + 32;
  }

  set fahrenheit(value: number) {
    if (value < -459.67) {
      throw new RangeError('Below absolute zero');
    }
    this._celsius = (value - 32) / 1.8;
  }
}

// Standalone arrow function (not inline callback, not IIFE)
// Exercises extractArrowFunction happy path (lines 109-110)
export const squareIfPositive = (x: number): number => {
  if (x > 0) {
    return x * x;
  }
  return 0;
};

// Function expression (not inline callback, not IIFE)
// Exercises extractFunctionExpression happy path (lines 115-117)
export const multiplyOrZero = function (a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  return a * b;
};

// Outer function containing a nested standalone function
// The nested function should NOT contribute complexity to the outer function.
export function outerWithNestedFunction(items: number[]): number {
  function innerHelper(x: number): number {
    if (x > 0) {
      return x * 2;
    }
    return x;
  }

  let result = 0;
  for (const item of items) {
    result += innerHelper(item);
  }
  return result;
}
