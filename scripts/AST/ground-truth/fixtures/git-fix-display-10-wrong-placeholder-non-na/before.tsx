import { createColumnHelper } from '@tanstack/react-table';

interface UserRow {
  name: string;
  email: string | null;
}

const columnHelper = createColumnHelper<UserRow>();

export const columns = [
  columnHelper.accessor('name', {
    header: 'Name',
    cell: info => info.getValue(),
  }),
  columnHelper.accessor('email', {
    header: 'Email',
    cell: info => info.getValue() ?? '--',
  }),
];
