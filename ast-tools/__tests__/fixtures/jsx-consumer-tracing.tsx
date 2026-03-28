import React from 'react';
import { Button } from './simple-component';

interface PageProps {
  title: string;
}

export function Page({ title }: PageProps) {
  return (
    <div>
      <h1>{title}</h1>
      <Button label='Click me' onClick={() => {}} />
    </div>
  );
}
