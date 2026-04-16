import { add, subtract, multiply } from '../calculator';

describe('calculator', () => {
  it('adds two numbers', () => {
    expect(add(1, 2)).toBe(3);
  });

  it('subtracts two numbers', () => {
    expect(subtract(5, 3)).toBe(2);
  });

  it('multiplies two numbers', () => {
    expect(multiply(2, 3)).toBe(6);
  });
});
