import { sharedUtil } from '../../lib';

export function handleRequest(input: string): string {
  return sharedUtil(input);
}

export function unusedEndpoint(): string {
  return 'not used';
}
