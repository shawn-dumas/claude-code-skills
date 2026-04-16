import React from 'react';

interface User {
  name: string;
  role: 'admin' | 'manager' | 'member' | 'guest';
  tier: 'free' | 'pro' | 'enterprise';
}

interface Props {
  user: User;
  isOnline: boolean;
}

export function UserBadge({ user, isOnline }: Props) {
  return (
    <div className='user-badge'>
      <span className='name'>{user.name}</span>
      <span className='role-label'>
        {user.role === 'admin'
          ? 'Administrator'
          : user.role === 'manager'
            ? 'Team Manager'
            : user.role === 'member'
              ? 'Team Member'
              : 'Guest User'}
      </span>
      <span className='tier-label'>
        {user.tier === 'enterprise' ? 'Enterprise Plan' : user.tier === 'pro' ? 'Professional Plan' : 'Free Plan'}
      </span>
      <span className='status'>{isOnline ? 'Online' : 'Offline'}</span>
    </div>
  );
}
