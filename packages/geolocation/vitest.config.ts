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
        // Generated io-core copy (sync-io-core.mjs): byte-identical to fetch's,
        // which tests it fully. Capability-only (no lane). See scripts/sync-io-core.mjs.
        'src/core/platformCapability.ts'
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
