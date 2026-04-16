/* eslint-disable */
import React from 'react';
import { useTeamQuery } from '@/services/hooks/queries/team';
import { useAuthState } from '@/providers/context/auth';

interface Props {
  teamId: string;
}

export function TeamContainer({ teamId }: Props) {
  const { data: team } = useTeamQuery({ teamId });
  const { user } = useAuthState();

  return (
    <div>
      <span>{team?.name}</span>
      <span>{user?.email}</span>
    </div>
  );
}
