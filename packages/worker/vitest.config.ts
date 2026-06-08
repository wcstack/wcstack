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
        // Cross-package scaffolding retained for consistency but intentionally
        // unused by WorkerCore's never-throw design (see raiseError.ts header).
        // Not imported anywhere, so v8 never reports it today; excluding it keeps
        // the 100% thresholds honest if coverage ever switches to `all: true`.
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
