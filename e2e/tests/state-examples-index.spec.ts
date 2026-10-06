import { test, expect } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectErrors } from "./helpers";

// state: packages/state/examples の目次ページ。状態もバインディングも持たない静的な一覧で、
// 各デモへの相対リンク (`<name>/`) を並べる。リンクがすべて実在するデモ (index.html を持つ
// ディレクトリ) を指し、配信で解決でき、逆にデモのディレクトリが目次から漏れていないことと、
// リンクを辿ると 4.0 の /auto でデモが動くことを固定する。
const PAGE = "/packages/state/examples/";
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const EXAMPLES_DIR = resolve(REPO_ROOT, "packages", "state", "examples");

// index.html を持つデモのディレクトリ (共有アセットの shared/ は除く)
const demoDirs = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "shared" && existsSync(resolve(EXAMPLES_DIR, d.name, "index.html")))
  .map((d) => d.name)
  .sort();

test.describe("packages/state/examples/index.html", () => {
  test("各リンクは名前と説明を持ち、実在するデモを指して配信で解決できる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    await expect(page.locator("h1")).toHaveText("Examples");
    const links = page.locator(".example-list a");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);

    const hrefs: string[] = [];
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      await expect(link.locator(".name")).not.toBeEmpty();
      await expect(link.locator(".desc")).not.toBeEmpty();
      const href = (await link.getAttribute("href"))!;
      // 相対の `<dir>/` 形 (末尾スラッシュでデモ内の相対 URL が解決する)
      expect(href, href).toMatch(/^[\w-]+\/$/);
      hrefs.push(href.slice(0, -1));

      const res = await page.request.get(new URL(href, page.url()).href);
      expect(res.status(), href).toBe(200);
      expect(res.headers()["content-type"], href).toContain("text/html");
      expect(await res.text(), href).toContain("<title>");
    }

    // リンク先の集合 = index.html を持つデモのディレクトリの集合 (重複も漏れもない)
    expect([...hrefs].sort()).toEqual(demoDirs);

    expect(errors).toEqual([]);
  });

  test("リンクを辿るとデモが開き、4.0 の /auto でバインディングが動く", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    await page.locator(".example-list a", { hasText: "Hello World" }).click();
    await expect(page).toHaveURL(/\/packages\/state\/examples\/hello-world\/$/);
    await expect(page.locator(".example-container h1")).toHaveText("Hello World!");
    await page.locator('input[type="text"]').fill("from index");
    await expect(page.locator(".example-container h1")).toHaveText("from index");

    await page.goBack();
    await page.locator(".example-list a", { hasText: "Simple Counter" }).click();
    await expect(page.locator("h1 span")).toHaveText("0");
    await page.locator("button", { hasText: "Increment" }).click();
    await expect(page.locator("h1 span")).toHaveText("1");

    expect(errors).toEqual([]);
  });
});
