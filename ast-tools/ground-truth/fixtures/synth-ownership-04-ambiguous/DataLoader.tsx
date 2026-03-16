/* eslint-disable */
import React from 'react';
import { useTeamQuery } from '@/services/hooks/queries/team';

export function DataLoader() {
  const { data: team } = useTeamQuery({ teamId: 'default' });

  return (
    <div>
      <span>{team?.name}</span>
    </div>
  );
}
