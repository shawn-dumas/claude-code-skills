import { createColumnHelper } from '@tanstack/react-table';
import { NO_VALUE_PLACEHOLDER } from '@/shared/constants';

interface UserRow {
  name: string;
  email: string | null;
}

const columnHelper = createColumnHelper<UserRow>();

export const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: info => info.getValue() ?? NO_VALUE_PLACEHOLDER,
  }),
  columnHelper.accessor('email', {
    header: 'Email',
    cell: info => info.getValue() ?? NO_VALUE_PLACEHOLDER,
  }),
];
