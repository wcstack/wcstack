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
        // Generated copy of the shared io-core capability layer (byte-identical to
        // fetch's, which tests it fully); camera uses only the WcsIoErrorInfo type.
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
