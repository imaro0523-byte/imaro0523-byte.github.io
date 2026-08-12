import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: false,
    // Individual suites opt into jsdom with `// @vitest-environment jsdom`.
    environmentMatchGlobs: [['tests/unit/dom/**', 'jsdom']],
  },
});
