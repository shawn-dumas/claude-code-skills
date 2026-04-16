/* eslint-disable */
import React, { useState } from 'react';
import { useTeamQuery } from '@/services/hooks/queries/team';
import { useUsersQuery } from '@/services/hooks/queries/users';
import { useUpdateUserMutation } from '@/services/hooks/mutations/users';
import { useAuthState } from '@/providers/context/auth';
import { usePosthogContext } from '@/providers/context/posthog';
import { useTeams } from '@/providers/context/teams';
import { useQuery } from '@tanstack/react-query';

interface Props {
  teamId: string;
}

export function ServiceAndContextPanel({ teamId }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data: team } = useTeamQuery({ teamId });
  const { data: users } = useUsersQuery({ teamId });
  const { mutate: updateUser } = useUpdateUserMutation();
  const { user } = useAuthState();
  const { featureFlags } = usePosthogContext();
  const { teams } = useTeams();
  const { data: extra } = useQuery({ queryKey: ['extra'], queryFn: () => [] });

  return (
    <div>
      <span>{user?.email}</span>
      <span>{teams.length}</span>
      <span>{team?.name}</span>
      <span>{users?.length}</span>
      <span>{JSON.stringify(featureFlags)}</span>
      <span>{extra?.length}</span>
      <button onClick={() => updateUser({ id: selected ?? '' })}>Save</button>
    </div>
  );
}
