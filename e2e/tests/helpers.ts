import type { Page } from "@playwright/test";

// Collects uncaught exceptions and console.error output for the page. Smoke
// tests assert the array stays empty: a broken binding or a failed module load
// surfaces here before (or without) any visible symptom.
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}
