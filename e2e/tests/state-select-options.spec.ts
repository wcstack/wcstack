import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// A <select> whose options a `for` renders: its bound value is applied before the options exist
// (bindings apply in document order), and must be selected once they are. @wcstack/state 3.3
// applies a select's value after the options of the same batch; the 4.0 engine (state-next)
// applies it again whenever a view renders options into the select (F31).

declare global {
  interface Window {
    __write: (fn: (s: any) => void) => void;
  }
}

const values = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({
    root: (document.getElementById("root") as HTMLSelectElement).value,
    index: (document.getElementById("index") as HTMLSelectElement).selectedIndex,
    group: (document.getElementById("group") as HTMLSelectElement).value,
    late: (document.getElementById("late") as HTMLSelectElement).selectedIndex,
    rows: Array.from(document.querySelectorAll<HTMLSelectElement>("#rows select")).map((s) => s.value),
  }));
const shared = (page: import("@playwright/test").Page) =>
  page.evaluate(() => Array.from(document.querySelectorAll<HTMLSelectElement>("#shared select")).map((s) => s.value));

test("最初の描画で、<select> の値が for の描いた選択肢から選ばれる（ルート・selectedIndex・optgroup・行の中）", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/e2e/fixtures/state-select-options.html");
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("#rows select").length)).toBe(2);
  expect(await values(page)).toEqual({ root: "b", index: 2, group: "b", late: -1, rows: ["b", "c"] });
  expect(errors).toEqual([]);
});

test.describe("選択肢が後から変わる", () => {
  test.skip(process.env.STATE !== "next", "@wcstack/state 3.3 applies a select's value only in the batch that writes it, and renders no rows over a top-level list inside a row (#376)");

  test("行ごとに同じ選択肢（行の中でトップレベルのリストを回す for:、#376）も、行の値が選ばれる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/state-select-shared-options.html");
    await expect.poll(() => shared(page)).toEqual(["b", "c"]);
    await page.evaluate(() => window.__write((s) => { s.options = [...s.options, { v: "d" }]; s["rows.0.choice"] = "d"; }));
    await expect.poll(() => shared(page)).toEqual(["d", "c"]);
    expect(errors).toEqual([]);
  });

  test("選択肢を後から読み込む・並べ替える・選んだ選択肢を消して戻す", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/state-select-options.html");
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("#rows select").length)).toBe(2);
    // loaded later (empty → three)
    await page.evaluate(() => window.__write((s) => { s.late = [{ v: "a" }, { v: "b" }, { v: "c" }]; }));
    await expect.poll(async () => (await values(page)).late).toBe(1);
    // reordered: the chosen value stays chosen
    await page.evaluate(() => window.__write((s) => { s.options = [{ v: "c" }, { v: "b" }, { v: "a" }]; }));
    await expect.poll(async () => (await values(page)).root).toBe("b");
    // the chosen option leaves: nothing is selected (state still says "b"); it comes back selected
    await page.evaluate(() => window.__write((s) => { s.options = [{ v: "a" }, { v: "c" }]; }));
    await expect.poll(async () => page.evaluate(() => (document.getElementById("root") as HTMLSelectElement).selectedIndex)).toBe(-1);
    await page.evaluate(() => window.__write((s) => { s.options = [{ v: "a" }, { v: "b" }, { v: "c" }]; }));
    await expect.poll(async () => (await values(page)).root).toBe("b");
    // the user's choice is written back and kept when the options change
    await page.selectOption("#root", "c");
    await page.evaluate(() => window.__write((s) => { s.options = [...s.options, { v: "d" }]; }));
    await expect.poll(async () => (await values(page)).root).toBe("c");
    expect(errors).toEqual([]);
  });
});
