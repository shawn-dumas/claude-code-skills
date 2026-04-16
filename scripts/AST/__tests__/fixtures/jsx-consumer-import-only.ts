import { Button } from './simple-component';

// Re-export only, no JSX rendering
export { Button };

export function getButtonLabel(): string {
  return 'Click me';
}
