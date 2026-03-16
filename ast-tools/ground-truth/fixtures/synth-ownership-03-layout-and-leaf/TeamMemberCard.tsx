/* eslint-disable */
import React from 'react';
import { useTeamQuery } from '@/services/hooks/queries/team';

interface Props {
  memberId: string;
  teamId: string;
}

export function TeamMemberCard({ memberId, teamId }: Props) {
  const { data: team } = useTeamQuery({ teamId });
  const member = team?.members?.find((m: { id: string }) => m.id === memberId);

  return (
    <div>
      <span>{member?.name}</span>
    </div>
  );
}
