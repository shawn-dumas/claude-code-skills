import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: __dirname,
    include: ['__tests__/**/*.spec.ts'],
    exclude: ['__tests__/fixtures/**/*'],
    globals: true,
    environment: 'node',
    testTimeout: 15_000,
  },
});
