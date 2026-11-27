import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    // the parts link /styles.css in their shadow roots; happy-dom does not load CSS
    environmentOptions: { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true } } },
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup.js"],
    testTimeout: 20000,
  },
});
