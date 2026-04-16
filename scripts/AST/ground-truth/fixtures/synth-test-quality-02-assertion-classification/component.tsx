import React from 'react';

interface Props {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function ActionButton({ label, onClick, disabled }: Props) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label}>
      {label}
    </button>
  );
}
