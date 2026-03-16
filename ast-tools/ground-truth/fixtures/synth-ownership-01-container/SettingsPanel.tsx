/* eslint-disable */
import React from 'react';
import { useTeamQuery } from '@/services/hooks/queries/team';
import { usePathname } from 'next/navigation';

interface Props {
  teamId: string;
}

export function SettingsPanel({ teamId }: Props) {
  const { data: team } = useTeamQuery({ teamId });
  const pathname = usePathname();

  return (
    <div>
      <span>{pathname}</span>
      <span>{team?.name}</span>
    </div>
  );
}
