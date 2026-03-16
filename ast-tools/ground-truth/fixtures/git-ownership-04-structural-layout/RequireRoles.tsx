/* eslint-disable */
import React from 'react';
import { useAuthState } from '@/providers/context/auth';

interface Props {
  allowedRoles: string[];
  children: React.ReactNode;
}

export function RequireRoles({ allowedRoles, children }: Props) {
  const { roles, logOut } = useAuthState();

  const isForbidden = !roles || roles.length === 0 || !allowedRoles.some(allowed => roles.includes(allowed));

  if (isForbidden) {
    return (
      <div>
        <p>Access Denied</p>
        <button onClick={() => logOut()}>Sign Out</button>
      </div>
    );
  }
  return <>{children}</>;
}
