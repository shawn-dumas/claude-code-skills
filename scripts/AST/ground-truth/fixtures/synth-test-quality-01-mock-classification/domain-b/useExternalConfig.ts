import { useState } from 'react';

export function useExternalConfig() {
  const [config, setConfig] = useState<Record<string, string>>({});
  return { config, setConfig };
}
