import { test, expect } from "@playwright/test";

// A delegated handler on an element that follows a <wcs-link> in a for: row or an if: block
// (docs/seam-apps.md, town-archive).
//
// @wcstack/state finds a block's delegated handlers by the element's position in the block, and <wcs-link> puts
// its <a> right after itself, so every later sibling under the same parent moved by one. Up to 4.23, written with
// no whitespace, a click on ★ ran the handler of the 削除 beside it and a click on the link ran the ★'s; with
// whitespace between them neither button's handler ran. Nothing in the console either way. An element after a
// custom element now keeps its handler on itself (packages/state/src/dom/plan.ts, shifts()).
//
// The package's unit tests use a stand-in element that inserts a node after itself. This is the router's own link.

const FIXTURE = "/e2e/fixtures/link-row-handlers.html";

test("行の中で <wcs-link> の後ろにあるボタン: 押したボタンのハンドラが、その行の添字で動く", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(FIXTURE);
  await expect(page.locator("#tight li")).toHaveCount(3);
  const log = page.locator("#log");

  // written tight: ★ of the second row, 削除 of the third
  await page.locator("#tight li").nth(1).locator(".star").click();
  await expect(log).toHaveText("star(1)");
  await page.locator("#tight li").nth(2).locator(".remove").click();
  await expect(log).toHaveText("star(1) remove(2)");

  // written with whitespace
  await page.locator("#spaced li").nth(0).locator(".star").click();
  await page.locator("#spaced li").nth(1).locator(".remove").click();
  await expect(log).toHaveText("star(1) remove(2) star(0) remove(1)");

  // an if: block
  await page.locator("#branch .edit").click();
  await expect(log).toHaveText("star(1) remove(2) star(0) remove(1) edit");
  expect(problems).toEqual([]);
});

test("リンクそのものを押しても、隣のボタンのハンドラは動かず、遷移だけする", async ({ page }) => {
  await page.goto(FIXTURE);
  await expect(page.locator("#tight li")).toHaveCount(3);
  await page.locator("#tight li").nth(1).locator("a").click();
  await expect(page.locator("#photo")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/e2e/fixtures/photos/2");
  // the page-level log is still there: no handler ran
  await expect(page.locator("#log")).toHaveText("");
});
