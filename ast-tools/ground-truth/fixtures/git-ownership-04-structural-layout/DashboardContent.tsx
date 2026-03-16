/* eslint-disable */
import React from 'react';

interface Props {
  children: React.ReactNode;
  pageTitle: string;
  filterComponent: React.ReactNode | null;
  filtersVisible: boolean;
}

export function DashboardContent({ children, pageTitle, filterComponent, filtersVisible }: Props) {
  return (
    <div>
      <head>
        <title>{pageTitle}</title>
      </head>
      <div>
        {filtersVisible && filterComponent && <nav>{filterComponent}</nav>}
        <section>{children}</section>
      </div>
    </div>
  );
}
