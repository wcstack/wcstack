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
        'src/webc.ts',
        'src/types.ts',
        'package.json',
        // Generated copy of the shared transition-runner protocol
        // (/protocol/transition-runner.ts). The router exercises the lookup and
        // the no-arbiter fallback (showRouteContent.transition.test.ts); the
        // manifest validity branches are covered once, in @wcstack/view-transition.
        'src/protocol/transitionRunner.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 97,
        functions: 100,
        lines: 100,
      },
    },
  },
});
