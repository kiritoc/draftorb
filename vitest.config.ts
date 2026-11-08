import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 15000,
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
  },
});
