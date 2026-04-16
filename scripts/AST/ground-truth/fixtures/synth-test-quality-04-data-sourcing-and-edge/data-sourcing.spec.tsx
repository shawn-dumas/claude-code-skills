import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ItemList } from './data-sourcing';
import { buildItems } from '@/fixtures/domains/items.fixture';
import { SHARED_TEST_DATA } from './__tests__/constants';

describe('ItemList', () => {
  it('renders fixture items', () => {
    const items = buildItems(3);
    render(<ItemList items={items} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('renders shared data', () => {
    render(<ItemList items={SHARED_TEST_DATA} />);
    expect(screen.getByRole('list')).toBeVisible();
  });
});
