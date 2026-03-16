/* eslint-disable */
import React from 'react';
import { useTeams } from '@/providers/context/teams';
import { useRouter } from 'next/router';

interface Props {
  collapsed: boolean;
}

export function Sidebar({ collapsed }: Props) {
  const { teams } = useTeams();
  const router = useRouter();

  return (
    <nav>
      {teams.map((t: { id: string; name: string }) => (
        <button key={t.id} onClick={() => router.push(`/team/${t.id}`)}>
          {collapsed ? t.id : t.name}
        </button>
      ))}
    </nav>
  );
}
