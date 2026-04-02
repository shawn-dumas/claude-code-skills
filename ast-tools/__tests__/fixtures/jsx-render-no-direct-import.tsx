import React from 'react';
import * as Components from './simple-component';

interface WrapperProps {
  label: string;
}

// Renders Button via namespace import -- not a direct named import
export function Wrapper({ label }: WrapperProps) {
  const Btn = Components.Button;
  return (
    <div>
      <Button label={label} onClick={() => {}} />
    </div>
  );
}

// Satisfy JSX requirement: reference Button as JSX element
// (This is a synthetic test fixture to exercise the "renders JSX but no direct import" path)
declare const Button: React.ComponentType<{ label: string; onClick: () => void }>;
