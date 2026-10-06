import { defineConfig } from 'vitest/config';

// The scale verification (bench/scale/, not the unit suite): npx vitest run --config bench/vitest.scale.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['bench/scale/**/*.test.ts'],
    pool: 'forks',
    // the boundedness probes read the heap after a full collection
    execArgv: ['--expose-gc'],
    fileParallelism: false,
  },
});
