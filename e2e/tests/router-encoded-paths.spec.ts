import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { collectErrors } from "./helpers";

// Issue #694 — a route's static segments are the characters as written, and the URL's segments are percent-decoded
// before they are compared.
//
// Up to 4.24.1:
// - a static segment was compiled as a regular expression as written: path="/v1.0" matched /v1x0, and path="/c++"
//   threw a SyntaxError out of the router — with that route in the page, no route was shown at all;
// - the URL's path was compared still percent-encoded: path="/café" matched no URL (the browser's pathname is
//   /caf%C3%A9), the id of /users/€ was "%E2%82%AC", and a <wcs-link to="/users/€"> was not the current page there;
// - without the Navigation API, navigate("/café") compared the string as written: the route showed, with
//   path "/café", and a reload of the same URL was a 404.
//
// happy-dom percent-encodes a pathname as browsers do, so the package's unit tests hold the rules; this spec is the
// router in real browsers, on both of its navigation paths. The checks tagged @browsers also run in the firefox project.

const FIXTURE = "/e2e/fixtures/router-encoded-paths.html";
const FIXTURE_FILE = fileURLToPath(new URL("../fixtures/router-encoded-paths.html", import.meta.url));

/** The static server has no deep links into a fixture: a path under its base that is no file is the fixture. */
async function serveDeepLinks(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith("/e2e/fixtures/") && !url.pathname.endsWith(".html"),
    (route) => route.fulfill({ path: FIXTURE_FILE, contentType: "text/html; charset=utf-8" }),
  );
}

interface Seen {
  route: string;
  params: Record<string, string>;
  path: string;
  view: string | null;
  /** The ids of the links marked as the current page. */
  current: string[];
}

async function seen(page: Page): Promise<Seen> {
  await expect(page.locator("#view")).toBeVisible();
  return page.evaluate(() => {
    const router = document.querySelector("wcs-router") as HTMLElement & { routeName: string; params: Record<string, string>; path: string };
    return {
      route: router.routeName,
      params: { ...router.params },
      path: router.path,
      view: document.querySelector("#view")!.textContent,
      current: [...document.querySelectorAll("wcs-link")]
        .filter((link) => link.nextElementSibling?.getAttribute("aria-current") === "page")
        .map((link) => link.id),
    };
  });
}

const open = async (page: Page, path: string): Promise<Seen> => {
  await page.goto("/e2e/fixtures" + path);
  return seen(page);
};

test("静的セグメントは書かれた文字そのもの: /v1x0 は path=\"/v1.0\" に一致せず、path=\"/c++\" があってもルーターは動く @browsers", async ({ page }) => {
  const errors = collectErrors(page);
  await serveDeepLinks(page);
  expect(await open(page, "/v1x0")).toMatchObject({ route: "404", view: "not found" });
  expect(await open(page, "/v1.0")).toMatchObject({ route: "v1", view: "v1.0", current: ["l-v1"] });
  expect(await open(page, "/c++")).toMatchObject({ route: "cpp", view: "c++", current: ["l-cpp"] });
  expect(await open(page, "/c")).toMatchObject({ route: "404" });
  expect(errors).toEqual([]);
});

test("読み込み: URL のセグメントはデコードして比べ、パラメータはデコードされた文字列。path は URL の形 @browsers", async ({ page }) => {
  const errors = collectErrors(page);
  await serveDeepLinks(page);
  expect(await open(page, "/café")).toMatchObject({ route: "cafe", view: "café", path: "/caf%C3%A9", current: ["l-cafe"] });
  expect(await open(page, "/caf%C3%A9")).toMatchObject({ route: "cafe", path: "/caf%C3%A9" });
  expect(await open(page, "/users/€")).toMatchObject({ route: "user", params: { id: "€" }, path: "/users/%E2%82%AC", current: ["l-euro"] });
  expect(await open(page, "/users/a b")).toMatchObject({ params: { id: "a b" }, path: "/users/a%20b", current: ["l-space"] });
  // an encoded slash stays in the value; an encoded percent sign is one
  expect(await open(page, "/users/a%2Fb")).toMatchObject({ route: "user", params: { id: "a/b" }, path: "/users/a%2Fb", current: [] });
  expect(await open(page, "/users/100%25")).toMatchObject({ params: { id: "100%" } });
  // an escape that is not UTF-8 is passed as it is
  expect(await open(page, "/users/%E0%A4%A")).toMatchObject({ route: "user", params: { id: "%E0%A4%A" } });
  expect(await open(page, "/files/a b/ç.txt")).toMatchObject({ route: "files", params: { "*": "a b/ç.txt" }, path: "/files/a%20b/%C3%A7.txt" });
  expect(errors).toEqual([]);
});

test("リンクと navigate() でも読み込みと同じ結果で、行き先のリンクが現在のページになる @browsers", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(FIXTURE);
  await expect(page.locator("#view")).toHaveText("home");
  await page.getByRole("link", { name: "café" }).click();
  await expect(page.locator("#view")).toHaveText("café");
  expect(await seen(page)).toMatchObject({ route: "cafe", path: "/caf%C3%A9", current: ["l-cafe"] });
  await page.getByRole("link", { name: "user €" }).click();
  await expect(page.locator("#view")).toHaveText("user");
  expect(await seen(page)).toMatchObject({ params: { id: "€" }, path: "/users/%E2%82%AC", current: ["l-euro"] });
  await page.evaluate(() => (document.querySelector("wcs-router") as unknown as { navigate(to: string): Promise<void> }).navigate("/users/a b"));
  await expect.poll(async () => (await seen(page)).params.id).toBe("a b");
  expect(await seen(page)).toMatchObject({ path: "/users/a%20b", current: ["l-space"] });
  await page.getByRole("link", { name: "c++" }).click();
  await expect(page.locator("#view")).toHaveText("c++");
  expect(new URL(page.url()).pathname).toBe("/e2e/fixtures/c++");
  expect(errors).toEqual([]);
});

test("Navigation API の無い経路でも同じ: path は URL の形で、再読み込みしても変わらない @browsers", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(() => {
    Object.defineProperty(window, "navigation", { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await serveDeepLinks(page);
  await page.goto(FIXTURE);
  await expect(page.locator("#view")).toHaveText("home");
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).navigation === undefined)).toBe(true);

  for (const [to, expected] of [
    ["/café", { route: "cafe", path: "/caf%C3%A9", current: ["l-cafe"] }],
    ["/users/€", { route: "user", params: { id: "€" }, path: "/users/%E2%82%AC", current: ["l-euro"] }],
    ["/users/a%2Fb", { route: "user", params: { id: "a/b" }, path: "/users/a%2Fb", current: [] }],
  ] as const) {
    await page.evaluate((target) => (document.querySelector("wcs-router") as unknown as { navigate(to: string): Promise<void> }).navigate(target), to);
    await expect.poll(async () => (await seen(page)).path).toBe(expected.path);
    const navigated = await seen(page);
    expect(navigated).toMatchObject(expected);
    // the same URL loaded: the same route, params and path
    await page.reload();
    expect(await seen(page)).toEqual(navigated);
  }
  expect(errors).toEqual([]);
  await context.close();
});
