/* eslint-disable */
// Negative fixture: pure presentational component with NO hooks.
// Should produce zero hook assessments from ast-interpret-hooks.

import React from 'react';

type StatusBadgeProps = {
  label: string;
  active: boolean;
};

export function StatusBadge({ label, active }: StatusBadgeProps) {
  return <span className={active ? 'active' : 'inactive'}>{label}</span>;
}
