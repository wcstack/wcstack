import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        // entries that only re-export or install (their behaviour is tested through what they wire)
        'src/index.ts',
        'src/core.ts',
        'src/core-entry.ts',
        'src/auto.ts',
        // types only
        'src/public/types.ts',
        'src/parser/types.ts',
        'src/strategy/types.ts',
        // generated copy of the shared transition-runner protocol (/protocol/transition-runner.ts)
        'src/protocol/transitionRunner.ts',
      ],
      // the same thresholds as @wcstack/state 3.x
      thresholds: {
        statements: 99.5,
        branches: 98.5,
        functions: 100,
        lines: 99.5,
      },
    },
  },
});
