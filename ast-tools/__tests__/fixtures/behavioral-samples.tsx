import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';

type Props = {
  visible?: boolean;
  maxItems?: number;
  label?: string;
  id: string;
  value?: string;
};

type Data = { name: string; email: string };

// DEFAULT_PROP_VALUE
export function MyComponent({ visible = true, maxItems = 10, label = 'Default Label', id, value }: Props) {
  // STATE_INITIALIZATION
  const [count, setCount] = useState(0);
  const [name, setName] = useState('');
  const [items, setItems] = useState<string[]>([]);

  // RENDER_CAP
  const displayed = items.slice(0, maxItems);

  // NULL_COERCION_DISPLAY
  const displayName = name ?? 'N/A';
  const fallback = value || '-';

  // TYPE_COERCION_BOUNDARY
  const numericId = Number(id);
  const strValue = count.toString();

  // CONDITIONAL_RENDER_GUARD + JSX_STRING_LITERAL
  return (
    <div>
      {visible && <span>Content</span>}
      {count > 0 ? <span>{count}</span> : <span>No items</span>}
      <button aria-label='Save changes'>Save</button>
      <input placeholder='Enter your name' />
    </div>
  );
}

// COLUMN_DEFINITION
const columnHelper = createColumnHelper<Data>();
export const columns = [
  columnHelper.accessor('name', { header: 'Full Name' }),
  columnHelper.accessor('email', { header: 'Email Address' }),
  columnHelper.display({ id: 'actions', header: 'Actions' }),
];

// Suppress unused variable warnings
void MyComponent;
