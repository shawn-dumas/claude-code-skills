import React from 'react';

interface User {
  id: string;
  name: string;
  active: boolean;
}

interface Props {
  users: User[];
}

export function UserList({ users }: Props) {
  return (
    <div className='user-list'>
      <h2>Users ({users.length})</h2>
      {users.map(user => (
        <div key={user.id} className='user-row'>
          <span>{user.name}</span>
          <span>{user.active ? 'Active' : 'Offline'}</span>
        </div>
      ))}
    </div>
  );
}
