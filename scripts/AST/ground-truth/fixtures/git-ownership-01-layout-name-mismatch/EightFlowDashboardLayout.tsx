/* eslint-disable */
import React, { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthState } from '@/providers/context/auth';
import { useDashboardFiltersState } from '@/providers/context/layout';

interface Props {
  children: React.ReactNode;
  filtersType: string | null;
  pageName: string;
}

export function EightFlowDashboardLayout({ children, filtersType, pageName }: Props) {
  const { user } = useAuthState();
  const pathname = usePathname();
  const { isCollapsed } = useDashboardFiltersState();

  const filtersVisible = !!filtersType && !isCollapsed;
  const pageTitle = `${pageName} | 8Flow`;

  return (
    <div>
      <header>{pageTitle}</header>
      {filtersVisible && <nav>Filters</nav>}
      <main>{children}</main>
    </div>
  );
}
