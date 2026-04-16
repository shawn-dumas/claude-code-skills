/* eslint-disable */
import React from 'react';
import { useUsersQuery } from '@/services/hooks/queries/users';
import { useRouter } from 'next/router';
import { toast } from 'react-hot-toast';

interface Props {
  orgId: string;
}

export function DashboardContainer({ orgId }: Props) {
  const { data: users } = useUsersQuery({ orgId });
  const router = useRouter();

  const handleClick = () => {
    toast.success('Done');
    router.push('/settings');
  };

  return (
    <div>
      <span>{users?.length}</span>
      <button onClick={handleClick}>Go</button>
    </div>
  );
}
