/**
 * Contract test for the README section "Testing Your Page" (README.md /
 * README.ja.md, recipe 1: vitest + happy-dom).
 *
 * The test body mirrors the README recipe line for line, using the public
 * entry point names (`bootstrapState`, `getBindingsReady`, the element's
 * `connectedCallbackPromise` / `createStateAsync`) rather than internals.
 * If the recipe in the README changes, change this test in the same PR — the
 * README must never describe a flow that does not run.
 */
import { describe, it, expect, beforeAll } from "vitest";
// README: import { bootstrapState, getBindingsReady } from "@wcstack/state";
import { bootstrapState, getBindingsReady } from "../src/exports";

// README: the element's instance surface used by tests (not a public type).
interface StateElement extends HTMLElement {
  readonly connectedCallbackPromise: Promise<void>;
  createStateAsync(
    mutability: "readonly" | "writable",
    callback: (state: any) => Promise<void>,
  ): Promise<void>;
}

// README: the setup file — register the elements once, and route inline
// `<script type="module">` state through the `data:` URL loader (Node cannot
// import `blob:` URLs, so the blob path used in browsers would hang).
beforeAll(() => {
  bootstrapState();
  (URL as any).createObjectURL = undefined;
});

/** README: let the microtask / macrotask queues drain after a write. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("README「Testing Your Page」レシピ 1（vitest + happy-dom）", () => {
  it("mount → 初期描画の検証 → 書き換え → 再描画の検証、が README の手順どおりに動くこと", async () => {
    // 1. Mount the page fragment under test.
    document.body.innerHTML = `
      <wcs-state json='{"count": 1, "items": ["apple", "banana"]}'></wcs-state>
      <p id="count" data-wcs="textContent: count"></p>
      <ul id="items">
        <template data-wcs="for: items">
          <li data-wcs="textContent: items.*"></li>
        </template>
      </ul>
    `;

    // 2. Wait for the state element, then for every binding under `document`.
    const stateEl = document.querySelector("wcs-state") as StateElement;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    // 3. Assert the initial render.
    expect(document.querySelector("#count")!.textContent).toBe("1");
    expect(document.querySelectorAll("#items li").length).toBe(2);

    // 4. Write through a writable proxy, exactly as a handler would.
    await stateEl.createStateAsync("writable", async (state) => {
      state.count = 42;
      state.items = [...(state.items as string[]), "cherry"];
    });
    await settle();

    // 5. Assert the re-render.
    expect(document.querySelector("#count")!.textContent).toBe("42");
    expect(document.querySelectorAll("#items li").length).toBe(3);
    expect(document.querySelectorAll("#items li")[2].textContent).toBe("cherry");

    document.body.innerHTML = "";
  });

  it("インライン <script type=\"module\"> の state（メソッド付き）も setup の createObjectURL 無効化で読み込め、クリックでメソッドが走ること", async () => {
    document.body.innerHTML = `
      <wcs-state>
        <script type="module">
          export default {
            count: 5,
            up() { this.count++; },
          };
        </script>
      </wcs-state>
      <p id="count" data-wcs="textContent: count"></p>
      <button id="up" data-wcs="onclick: up">+1</button>
    `;
    const stateEl = document.querySelector("wcs-state") as StateElement;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);
    expect(document.querySelector("#count")!.textContent).toBe("5");

    (document.querySelector("#up") as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector("#count")!.textContent).toBe("6");

    document.body.innerHTML = "";
  });
});
