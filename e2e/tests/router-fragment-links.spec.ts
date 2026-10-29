import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// From the city-library seam app (docs/seam-apps.md). The fixture has <base href="/e2e/fixtures/">,
// as every SPA under the router has a <base>.
//
// - A skip link (href="#main") resolved to the base's #main, and the router took it as a route change
//   to home. A link whose href as written is a bare fragment now moves in the page: the URL becomes
//   the current path and query plus the hash, the target is scrolled to and focused, and no route
//   changes — on the Navigation API path (NavigateEvent.sourceElement) and on the fallback path
//   (a click listener), forced here as router-a11y.spec.ts does, by shadowing window.navigation.
// - A <wcs-link> whose `to` has a query (`?q=a&page=2`, "Next page") was aria-current="page" on
//   `?q=a`: it is the current page only when the page's query has its parameters.
//
// The checks tagged @browsers also run in the firefox project.

const FIXTURE = "/e2e/fixtures/router-fragment-links.html";

const where = (page: Page): string => {
  const url = new URL(page.url());
  return url.pathname + url.search + url.hash;
};

/** The fixture, then /search?q=a by an SPA navigation (the static server has no deep links into it). */
async function openSearch(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await expect(page.locator("#view")).toHaveText("home");
  await page.getByRole("link", { name: "search" }).click();
  await expect(page.locator("#view")).toHaveText("search");
  expect(where(page)).toBe("/e2e/fixtures/search?q=a");
  // marks that a full load and a route re-render would take away
  await page.evaluate(() => {
    (window as unknown as Record<string, string>).__doc = "same-document";
    document.querySelector("#view")!.setAttribute("data-mark", "kept");
  });
}

async function sameDocumentSameContent(page: Page): Promise<void> {
  await expect(page.locator("#view")).toHaveText("search");
  await expect(page.locator("#view")).toHaveAttribute("data-mark", "kept");
  expect(await page.evaluate(() => (window as unknown as Record<string, string>).__doc)).toBe("same-document");
}

const PATHS = [
  { name: "Navigation API", fallback: false },
  { name: "fallback (no Navigation API)", fallback: true },
];

for (const { name, fallback } of PATHS) {
  test.describe(`router fragment links — ${name}`, () => {
    test.beforeEach(async ({ page }) => {
      if (fallback) {
        await page.addInitScript(() => {
          Object.defineProperty(window, "navigation", { value: undefined, configurable: true });
        });
      }
    });

    test("@browsers a skip link moves to #main on the current page, and Back returns without a route change", async ({ page }) => {
      const errors = collectErrors(page);
      await openSearch(page);
      const entries = await page.evaluate(() => history.length);

      await page.locator("#skip").focus();
      await page.keyboard.press("Enter");

      await expect.poll(() => where(page)).toBe("/e2e/fixtures/search?q=a#main");
      await sameDocumentSameContent(page);
      // focused (with tabindex="-1", as <main> takes no focus by itself) and scrolled to
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("main");
      await expect(page.locator("main")).toHaveAttribute("tabindex", "-1");
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
      // a history entry, as a fragment link pushes one
      expect(await page.evaluate(() => history.length)).toBe(entries + 1);

      // the same link again: the same URL, so the entry is replaced (what a browser does without <base>)
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator("#skip").focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
      expect(await page.evaluate(() => history.length)).toBe(entries + 1);

      // Back is a fragment traversal: no route re-render, the scroll position restored
      await page.goBack();
      await expect.poll(() => where(page)).toBe("/e2e/fixtures/search?q=a");
      await sameDocumentSameContent(page);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(100);
      expect(errors).toEqual([]);
    });

    test("@browsers href=\"#\" goes to the top of the current page, not to home", async ({ page }) => {
      const errors = collectErrors(page);
      await openSearch(page);
      await page.evaluate(() => window.scrollTo(0, 1500));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

      await page.locator("#top-link").click();

      await expect.poll(() => page.url().endsWith("/e2e/fixtures/search?q=a#")).toBe(true);
      await sameDocumentSameContent(page);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      expect(errors).toEqual([]);
    });

    test("@browsers a link with a query is aria-current only on that query", async ({ page }) => {
      const errors = collectErrors(page);
      await openSearch(page);
      const next = page.getByRole("link", { name: "Next page" });
      // on ?q=a: "Next page" (?q=a&page=2) is not the current page; "search" (/search?q=a) is
      await expect(next).not.toHaveAttribute("aria-current");
      await expect(next).not.toHaveClass(/active/);
      await expect(page.getByRole("link", { name: "search" })).toHaveAttribute("aria-current", "page");

      await next.click();
      await expect.poll(() => where(page)).toBe("/e2e/fixtures/search?q=a&page=2");
      await expect(next).toHaveAttribute("aria-current", "page");
      await expect(next).toHaveClass(/active/);
      // a page's extra parameters do not matter: "search" (?q=a) is still current on ?q=a&page=2
      await expect(page.getByRole("link", { name: "search" })).toHaveAttribute("aria-current", "page");

      await page.goBack();
      await expect.poll(() => where(page)).toBe("/e2e/fixtures/search?q=a");
      await expect(next).not.toHaveAttribute("aria-current");
      expect(errors).toEqual([]);
    });
  });
}

test.describe("router fragment links — what stays a navigation", () => {
  test("a link to another page's fragment (/e2e/fixtures/#main) is still a route change", async ({ page }) => {
    const errors = collectErrors(page);
    await openSearch(page);
    await page.locator("#faq").click();
    await expect(page.locator("#view")).toHaveText("home");
    expect(where(page)).toBe("/e2e/fixtures/#main");
    expect(errors).toEqual([]);
  });
});
