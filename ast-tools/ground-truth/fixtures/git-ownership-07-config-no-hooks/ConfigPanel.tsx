/* eslint-disable */
import React from 'react';

interface Config {
  title: string;
  maxItems: number;
  showHeader: boolean;
}

export function ConfigPanel({ config }: { config: Config }) {
  return <div>{config.showHeader && <h1>{config.title}</h1>}</div>;
}
