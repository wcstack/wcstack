import { test, expect } from "@playwright/test";

// docs/timing-and-firing-contract.md §25 — a move is not a disconnect.
//
// @wcstack/state moves a kept row with Node.moveBefore() where the browser has it (Chromium 133+,
// Firefox 144+), and a custom element is given disconnectedCallback + connectedCallback for that move unless
// its class defines connectedMoveCallback. An I/O node in the row then disposed: a <wcs-fetch> aborted its
// request and sent it again, a <wcs-upload> lost its upload without a word (docs/seam-apps.md, ekiden-entry).
// The I/O nodes whose work does not depend on where they are define the callback, and it does nothing.
//
// happy-dom has no moveBefore(), so the packages' unit tests only see that the class has the callback: this
// spec is where the browser calls it. Safari has no moveBefore() — the row is taken out and put back, which
// is a disconnect — so the spec does not run in WebKit.

const FIXTURE = "/e2e/fixtures/io-move-row.html";

test("並べ替えで動いた行の中の <wcs-fetch> は、進行中の要求を中断せず、送り直しもしない @browsers", async ({ page }) => {
  // every request waits here until the rows have moved
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const requested: string[] = [];
  await page.route("**/api/users/*", async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    await held;
    await route.continue();
  });

  await page.goto(FIXTURE);
  const rows = page.locator("#list li");
  await expect(rows).toHaveCount(4);
  for (let i = 0; i < 4; i++) await expect(rows.nth(i).locator(".loading")).toHaveText("true");
  expect(await page.evaluate(() => typeof Element.prototype.moveBefore)).toBe("function");

  // rows 2 and 4 change places while all four requests are in flight
  await page.click("#swap");
  await expect(rows.nth(1)).toHaveAttribute("data-id", "4");
  await expect(rows.nth(3)).toHaveAttribute("data-id", "2");
  // a moved row's request is still the one it started: not aborted (loading stays true, no status yet)
  for (let i = 0; i < 4; i++) {
    await expect(rows.nth(i).locator(".loading")).toHaveText("true");
    await expect(rows.nth(i).locator(".status")).toHaveText("0");
  }

  release();
  for (const id of [1, 2, 3, 4]) {
    const row = page.locator(`#list li[data-id="${id}"]`);
    await expect(row.locator(".status")).toHaveText("200");
    await expect(row.locator(".loading")).toHaveText("false");
    await expect(row.locator(".name")).not.toHaveText("");
  }
  // one request per row: a row that had been disconnected by the move would have sent its request twice
  expect(requested.sort()).toEqual(["/api/users/1", "/api/users/2", "/api/users/3", "/api/users/4"]);
});
