import { defineConfig } from "vitest/config";

// Pure libraries run in Node; the stepper and the page state declare `// @vitest-environment happy-dom`.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
  },
});
