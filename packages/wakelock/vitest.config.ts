import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['__tests__/**/*.{test,spec}.{js,ts}'],
    setupFiles: ['__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '__tests__/',
        'dist/',
        '*.config.{js,ts,mjs}',
        'src/exports.ts',
        'src/types.ts',
        // Intentional dead code kept for cross-package consistency (see the file's
        // header): a never-throw design means it is imported by nothing today, so v8
        // does not count it. Excluded explicitly so the intent is recorded and the
        // 100% thresholds do not depend on it staying unimported.
        'src/raiseError.ts'
      ],
      thresholds: {
        statements: 100,
        branches: 97,
        functions: 100,
        lines: 100
      }
    }
  }
});
