import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'socket-server/**',
      'web/**',
      'legacy/**',
      'quiz_cyber/**',
      'yolo/**',
    ],
    environment: 'node',
    setupFiles: ['apps/web/src/test-setup.ts'],
    reporters: ['default'],
  },
});
