import { defineConfig } from 'vitest/config';

// The measurements under bench/ (not the unit suite): npx vitest run --config bench/vitest.perf.config.ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['bench/**/*.perf.test.ts'],
  },
});
