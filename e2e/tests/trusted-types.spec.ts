import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// Trusted Types (docs/csp.md §7) under a real, enforcing Chromium. happy-dom has
// no Trusted Types, so the unit suites can only stub the sinks; this is the one
// place the four sinks are exercised against the engine:
//
//   state  innerHTML: binding      → adopter policy required (never signed by wcstack)
//   fetch  target= HTML replace    → adopter policy required (never signed by wcstack)
//   router <wcs-layout> expansion  → signed by the shared "wcstack" identity policy
//   worker new Worker(src)         → signed by the shared "wcstack" identity policy
//
// Each fixture installs the CSP through <meta http-equiv> and records
// securitypolicyviolation events in window.__violations.

type Violation = { directive: string; sample: string };

function collectWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning") warnings.push(msg.text());
  });
  return warnings;
}

const violations = (page: Page) => page.evaluate(() => (window as any).__violations as Violation[]);

test.describe("Trusted Types — enforcement precondition", () => {
  test("the fixture CSP is actually enforced by the engine", async ({ page }) => {
    await page.goto("/e2e/fixtures/trusted-types-state.html");
    const enforced = await page.evaluate(() => {
      if (!("trustedTypes" in window)) return "no-trusted-types";
      try {
        document.createElement("div").innerHTML = "<i></i>";
        return "not-enforced";
      } catch {
        return "enforced";
      }
    });
    expect(enforced).toBe("enforced");
  });
});

test.describe("Trusted Types — @wcstack/state innerHTML binding", () => {
  test("with an injected sanitizing policy the binding renders, and the policy ran", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/trusted-types-state.html");
    await expect(page.locator("#out #bold")).toHaveText("bold");
    await expect(page.locator("#plain")).toHaveText("text only");
    // The stand-in sanitizer strips <script>: the value went through createHTML, not around it.
    expect(await page.evaluate(() => (window as any).__ran)).toBeUndefined();
    expect(await violations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("with no policy the write is blocked, reported once with the fix, and the rest of the page still binds", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/trusted-types-state.html?policy=none");
    await expect(page.locator("#plain")).toHaveText("text only");
    await expect(page.locator("#out")).toBeEmpty();
    expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
    const reports = errors.filter((e) => e.includes('[@wcstack/state] Writing to "innerHTML" was blocked by Trusted Types'));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('Symbol.for("wcstack.trustedTypes.policy")');
    const v = await violations(page);
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => x.directive === "require-trusted-types-for")).toBe(true);
  });
});

test.describe("Trusted Types — @wcstack/router layout expansion", () => {
  test("expands the layout under `trusted-types wcstack` with no violation", async ({ page }) => {
    const errors = collectErrors(page);
    const warnings = collectWarnings(page);
    await page.goto("/e2e/fixtures/trusted-types-router.html");
    await expect(page.locator("#layout-header #title")).toHaveText("Layout header");
    await expect(page.locator("#layout-body #page")).toHaveText("Home page inside the layout");
    expect(await violations(page)).toEqual([]);
    expect(errors).toEqual([]);
    expect(warnings.filter((w) => w.includes("[@wcstack/router]"))).toEqual([]);
  });

  test("falls back to the injected policy with one warning when the wcstack name is not allowed", async ({ page }) => {
    const errors = collectErrors(page);
    const warnings = collectWarnings(page);
    await page.goto("/e2e/fixtures/trusted-types-router.html?allow=other");
    await expect(page.locator("#layout-header #title")).toHaveText("Layout header");
    await expect(page.locator("#layout-body #page")).toHaveText("Home page inside the layout");
    const fallback = warnings.filter((w) => w.includes("[@wcstack/router] Falling back to the injected Trusted Types policy"));
    expect(fallback).toHaveLength(1);
    // The engine itself logs the refused createPolicy("wcstack") as a CSP violation;
    // that line is Chromium's, not wcstack's. wcstack adds no error of its own — the
    // one warning above is the whole report when a fallback policy exists.
    const engineViolation = (e: string) => e.startsWith("console.error: Creating a TrustedTypePolicy named 'wcstack'");
    expect(errors.filter((e) => !engineViolation(e))).toEqual([]);
    // createPolicy("wcstack") is refused by the allowlist — that refusal is the only
    // violation; no script sink was ever written to with an untrusted value.
    const v = await violations(page);
    expect(v.every((x) => x.directive === "trusted-types")).toBe(true);
  });
});

test.describe("Trusted Types — @wcstack/fetch target= HTML replace mode", () => {
  test("with an injected sanitizing policy the response is injected, and the policy ran", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/trusted-types-fetch.html");
    await expect(page.locator("#out #fragment")).toHaveText("fragment from the server");
    expect(await page.evaluate(() => (window as any).__fragmentScriptRan)).toBeUndefined();
    expect(await violations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("with no policy the injection is blocked and reported once with the fix", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/trusted-types-fetch.html?policy=none");
    const reported = () => errors.some((e) => e.includes('[@wcstack/fetch] The "target" HTML replace mode was blocked by Trusted Types'));
    await expect.poll(reported).toBe(true);
    await expect(page.locator("#out")).toBeEmpty();
    // The auto-fetch path has nobody to catch a rejection from fetch(): the block
    // must be reported, not thrown (this is the case that found the bug).
    expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
    expect(errors.filter((e) => e.includes("[@wcstack/fetch]"))).toHaveLength(1);
    const v = await violations(page);
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => x.directive === "require-trusted-types-for")).toBe(true);
  });
});

test.describe("Trusted Types — @wcstack/worker new Worker(src)", () => {
  test("spawns the worker under `trusted-types wcstack` and delivers its message", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/trusted-types-worker.html");
    await expect(page.locator("#result")).toHaveText("worker started");
    expect(await violations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
