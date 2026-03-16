/* eslint-disable */
import React, { useMemo, useState } from 'react';
import { useChangeUserTeamRoleMutation } from '@/services/hooks/mutations/users';

interface Props {
  userName: string;
  teamId?: string;
  roles: string[];
  onClearAssignments: (id: string) => Promise<void>;
}

export function UserRoleSelect({ userName, teamId, roles, onClearAssignments }: Props) {
  const { mutateAsync: changeUserRoleForTeam } = useChangeUserTeamRoleMutation();
  const [isUpdating, setIsUpdating] = useState(false);

  const rolesList = useMemo(() => {
    return roles.length > 0 ? roles : [];
  }, [roles]);

  const handleChange = async (value: string) => {
    setIsUpdating(true);
    try {
      if (teamId) {
        await changeUserRoleForTeam({ role: value, teamId });
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div>
      <span>{userName}</span>
      <select onChange={e => handleChange(e.target.value)} disabled={isUpdating}>
        {rolesList.map(r => (
          <option key={r}>{r}</option>
        ))}
      </select>
    </div>
  );
}
