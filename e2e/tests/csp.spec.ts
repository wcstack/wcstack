import { test, expect, type Page } from "@playwright/test";

// Content-Security-Policy (docs/csp.md §4, §5, §9) under a real, enforcing Chromium. Every fixture
// uses a policy without blob:; what differs is whether the <script> that loads the bundle
// carries the page nonce, which the bundle's blob: import inherits.
//
// Firefox fires the violation after the import has failed (docs/csp.md §9); that ordering is
// covered by the state unit suite, since this project runs Chromium only.

type Violation = { directive: string; blocked: string };

const violations = (page: Page) => page.evaluate(() => (window as any).__violations as Violation[]);

/** How the state element's initialization ended: "(resolved)" or the failure's message. */
const outcome = (page: Page) =>
  page.evaluate(async () => {
    await customElements.whenDefined("wcs-state");
    const el = document.querySelector("wcs-state") as any;
    return el.connectedCallbackPromise.then(() => "(resolved)", (e: Error) => e.message);
  });

test.describe("CSP — @wcstack/state inline <script>", () => {
  test("a nonce on the <script> that loads state admits the blob: import", async ({ page }) => {
    await page.goto("/e2e/fixtures/csp-state-nonce.html");
    expect(await outcome(page)).toBe("(resolved)");
    await expect(page.locator("#out")).toHaveText("inline state loaded");
    // the one refusal is the browser's own evaluation of the inline <script>, not state's load
    const refused = await violations(page);
    expect(refused.filter((v) => v.blocked.startsWith("blob:"))).toEqual([]);
    expect(refused.filter((v) => v.blocked === "inline")).toHaveLength(1);
  });

  test("without it the blob: import is refused, and the failure names CSP", async ({ page }) => {
    await page.goto("/e2e/fixtures/csp-state-blocked.html");
    expect(await outcome(page)).toMatch(/was blocked by Content-Security-Policy/);
    await expect(page.locator("#out")).toHaveText("{{ message }}");
  });
});

test.describe("CSP — @wcstack/router guard", () => {
  test("a nonce on the <script> that loads router admits the guard's blob: import", async ({ page }) => {
    await page.goto("/e2e/fixtures/csp-router-nonce.html");
    await expect(page.locator("#out")).toHaveText("guarded route");
    expect(await page.evaluate(() => (window as any).__guard)).toBe("ran");
  });
});
