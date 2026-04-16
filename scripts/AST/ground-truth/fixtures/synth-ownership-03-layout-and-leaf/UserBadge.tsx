/* eslint-disable */
import React from 'react';
import { useAuthState } from '@/providers/context/auth';

interface Props {
  showEmail: boolean;
}

export function UserBadge({ showEmail }: Props) {
  const { user } = useAuthState();

  return (
    <span>
      {user?.displayName}
      {showEmail && <small>{user?.email}</small>}
    </span>
  );
}
