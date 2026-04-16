// Fixture for ast-export-surface tests.
// Contains various export types for detection.

// --- Named function export ---
export function greet(name: string): string {
  return `Hello, ${name}`;
}

// --- Const export ---
export const MAX_RETRIES = 3;

// --- Arrow function export (classified as function) ---
export const add = (a: number, b: number): number => a + b;

// --- Type export ---
export type UserId = string & { __brand: 'UserId' };

// --- Interface export ---
export interface Config {
  host: string;
  port: number;
}

// --- Enum export ---
export enum Status {
  Active = 'ACTIVE',
  Inactive = 'INACTIVE',
}

// --- Class export ---
export class Logger {
  log(message: string): void {
    void message;
  }
}

// --- Default export ---
export default function defaultHandler(): void {
  // no-op
}

// --- Reexport from another module ---
export { readFileSync } from 'fs';

// --- Namespace reexport ---
export * from 'path';

// --- Type-only reexport ---
export type { Dirent } from 'fs';
