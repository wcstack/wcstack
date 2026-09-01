import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapState, getBindingsReady } from "../src/exports";

/**
 * 同じ本文のインライン `<script type="module">` を 2 度読み込んでも state が共有されない
 * こと（loadFromInnerScript の loadSequence）。
 *
 * `data:` URL フォールバック経路（createObjectURL の無いテスト / SSR 環境）では URL が
 * 本文そのものなので、本文が同一だと ESM ローダーが同じモジュール = 同じ default export
 * オブジェクトを返し、2 つ目の `<wcs-state>` が 1 つ目の書き込みを引き継いでいた。
 * ブラウザの blob: 経路は URL が毎回一意で、この問題を持たない。
 */
interface StateElement extends HTMLElement {
  readonly connectedCallbackPromise: Promise<void>;
  createStateAsync(mutability: "readonly" | "writable", callback: (state: any) => Promise<void>): Promise<void>;
}

const SCRIPT = `
  <wcs-state>
    <script type="module">
      export default { count: 1, items: ["a"] };
    </script>
  </wcs-state>
  <p id="count" data-wcs="textContent: count"></p>
  <ul><template data-wcs="for: items"><li data-wcs="textContent: items.*"></li></template></ul>
`;

async function mountOnce(): Promise<StateElement> {
  document.body.innerHTML = SCRIPT;
  const el = document.querySelector("wcs-state") as StateElement;
  await el.connectedCallbackPromise;
  await getBindingsReady(document);
  return el;
}

beforeAll(() => {
  bootstrapState();
  // data: URL 経路に固定する（blob: は Node が import できず永久 pending になる）
  (URL as any).createObjectURL = undefined;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("インライン script の state はロードごとに独立している", () => {
  it("1 度目に書き込んだ値が、同じ本文の 2 度目のロードに漏れない", async () => {
    const first = await mountOnce();
    expect(document.querySelector("#count")!.textContent).toBe("1");
    await first.createStateAsync("writable", async (s) => {
      s.count = 99;
      s.items = [...s.items, "b"];
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector("#count")!.textContent).toBe("99");
    expect(document.querySelectorAll("li").length).toBe(2);

    document.body.innerHTML = "";
    await mountOnce();
    expect(document.querySelector("#count")!.textContent).toBe("1");
    expect(document.querySelectorAll("li").length).toBe(1);
  });
});
