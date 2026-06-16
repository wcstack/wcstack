import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['__tests__/**/*.{test,spec}.{js,ts}'],
    setupFiles: ['__tests__/setup.ts'],
    // Type-level gate config (run on demand via `vitest --typecheck`, or via the
    // standalone `npm run typecheck` → `tsc --noEmit -p tsconfig.test.json`). It is
    // NOT auto-enabled here: vitest's typecheck collector is experimental and its AST
    // pass can crash on valid generic-call syntax, which would make a plain
    // `vitest run` flaky. The npm `typecheck` script (plain tsc) is the authoritative
    // gate; this block lets `vitest --typecheck` reuse the same tsconfig when desired.
    typecheck: {
      tsconfig: './tsconfig.test.json',
      include: ['__tests__/**/*.{test,spec}.{js,ts}'],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Restrict coverage to this package's own src. The integration test imports
      // the real FetchCore from packages/fetch; without this include that sibling
      // file would be pulled into the coverage denominator.
      include: ['src/**'],
      exclude: [
        'src/exports.ts'
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  }
});
