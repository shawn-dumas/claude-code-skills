/* eslint-disable */
import React from 'react';
import { useAuthState } from '@/providers/context/auth';

interface Props {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: Props) {
  const { user } = useAuthState();

  return (
    <div>
      <header>{user?.email}</header>
      <main>{children}</main>
    </div>
  );
}
