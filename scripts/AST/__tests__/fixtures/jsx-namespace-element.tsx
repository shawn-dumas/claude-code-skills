import React from 'react';
import * as UI from './simple-component';

// Uses PropertyAccessExpression JSX: <UI.Button /> -> "UI.Button"
export function NamespacePage() {
  return (
    <div>
      <UI.Button label='Click' onClick={() => {}} />
    </div>
  );
}
