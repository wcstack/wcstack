import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// #357: bindings on the custom elements of a shadow root with a scoped CustomElementRegistry.
// happy-dom has no scoped registries, so this is the only place the contract is checked.
// @wcstack/state 3.3 waited on the global registry for these elements (the issue); the 4.0 engine
// reads the element's own registry.

declare global {
  interface Window {
    __ready: boolean;
    __defineLate: () => void;
    __write: (fn: (s: any) => void) => void;
  }
}

const texts = (page: import("@playwright/test").Page, sel: string) =>
  page.evaluate((s) => Array.from(document.getElementById("host")!.shadowRoot!.querySelectorAll(s)).map((e) => e.textContent), sel);

test("スコープ付き registry の要素に、最初に描いた行・後から足した行・ルートの束縛が入り、あとから定義した要素も値を受け取る", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/e2e/fixtures/state-scoped-registry.html");
  await page.waitForFunction(() => window.__ready === true);
  await expect.poll(() => texts(page, ".prop x-greet")).toEqual(["hello a", "hello b"]);
  await expect.poll(() => texts(page, ".spread x-greet")).toEqual(["hello a", "hello b"]);
  await expect.poll(() => texts(page, ".root x-greet")).toEqual(["hello z"]);
  // the global registry never learns the tag
  expect(await page.evaluate(() => customElements.get("x-greet"))).toBeUndefined();

  // a row added later, and a write
  await page.evaluate(() => window.__write((s) => { s.people = [...s.people, { name: "c" }]; s["one.name"] = "Z"; }));
  await expect.poll(() => texts(page, ".prop x-greet")).toEqual(["hello a", "hello b", "hello c"]);
  await expect.poll(() => texts(page, ".spread x-greet")).toEqual(["hello a", "hello b", "hello c"]);
  await expect.poll(() => texts(page, ".root x-greet")).toEqual(["hello Z"]);

  // defined in the scoped registry after the rows were rendered
  expect(await texts(page, ".late x-late")).toEqual(["", "", ""]);
  await page.evaluate(() => window.__defineLate());
  await expect.poll(() => texts(page, ".late x-late")).toEqual(["hello a", "hello b", "hello c"]);
  expect(errors).toEqual([]);
});
