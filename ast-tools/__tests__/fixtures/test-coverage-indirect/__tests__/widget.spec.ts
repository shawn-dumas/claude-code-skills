import { formatCurrency } from '../formatter';

describe('widget', () => {
  it('displays formatted price', () => {
    const result = formatCurrency(42.5, 'USD');
    expect(result).toBe('USD 42.50');
  });
});
