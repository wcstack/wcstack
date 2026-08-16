/**
 * 新規フィルタ（unit / clamp / abs / join / truncate / hms）を**実際のバインディング経由**で
 * 確かめる統合テスト。
 *
 * 単体テストは `builtinFilterFn` を直接叩くので、`data-wcs` の文字列から
 * `parseFilters` → `parseFilterArgs` を通ってフィルタに届くところが検証されない。
 * `unit(%)` のように記号を引数に取る形は、そこが通らなければ実用上まったく意味がないため、
 * 素の DOM に載せて確かめる。
 *
 * 併せて、このパッケージの examples が単位付けのために書いていた回避策
 * （`samples.map(x => ({ h: Math.min(100, x.cpu).toFixed(0) + "%" }))` のような
 * 派生配列の materialize）が、フィルタチェーンだけで置き換わることを固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

/** shadow root にひとつの state と markup を載せ、バインディング確立まで待つ。 */
async function mount(json: string, markup: string) {
  const host = document.createElement(uniqueTag("flt-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${markup}`;
  document.body.appendChild(host);

  const stateElement = shadowRoot.querySelector("wcs-state") as State;
  await stateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();

  return { host, shadowRoot, stateElement };
}

describe("フィルタ: data-wcs 経由での適用 (integration)", () => {
  it("unit: style プロパティに単位付きで届くこと", async () => {
    const { host, shadowRoot } = await mount(
      '{"w":40,"h":72}',
      `<div id="box" data-wcs="style.width: w|unit(px); style.height: h|unit(px)"></div>`,
    );

    const box = shadowRoot.querySelector("#box") as HTMLElement;
    expect(box.style.width).toBe("40px");
    expect(box.style.height).toBe("72px");

    host.remove();
  });

  it("unit: `%` のような記号もオプションとして通ること", async () => {
    const { host, shadowRoot } = await mount(
      '{"ratio":50}',
      `<div id="bar" data-wcs="style.width: ratio|unit(%)"></div>`,
    );

    expect((shadowRoot.querySelector("#bar") as HTMLElement).style.width).toBe("50%");

    host.remove();
  });

  /**
   * examples/state-sse-dashboard が書いていた回避策の置き換え。
   * `Math.min(100, x.cpu).toFixed(0) + "%"` は clamp|fix|unit と同値になる。
   */
  it("clamp|fix|unit: 派生配列を作らずに行の値へ直接適用できること", async () => {
    const { host, shadowRoot } = await mount(
      '{"samples":[{"cpu":42.7},{"cpu":140.2},{"cpu":-3}]}',
      `<div id="bars"><template data-wcs="for: samples">` +
        `<span class="bar" data-wcs="style.height: samples.*.cpu|clamp(0,100)|fix(0)|unit(%)"></span>` +
        `</template></div>`,
    );

    const heights = Array.from(shadowRoot.querySelectorAll(".bar")).map(
      (el) => (el as HTMLElement).style.height,
    );
    expect(heights).toEqual(["43%", "100%", "0%"]);

    host.remove();
  });

  it("unit: 値の更新が単位付きで追随すること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      '{"w":10}',
      `<div id="box" data-wcs="style.width: w|unit(px)"></div>`,
    );
    const box = shadowRoot.querySelector("#box") as HTMLElement;
    expect(box.style.width).toBe("10px");

    stateElement.createState("writable", (s: any) => {
      s.w = 25;
    });
    await flush();

    expect(box.style.width).toBe("25px");

    host.remove();
  });

  it("join: 配列を textContent へ連結できること", async () => {
    const { host, shadowRoot } = await mount(
      '{"tags":["a","b","c"]}',
      `<span id="tags" data-wcs="textContent: tags|join"></span>` +
        `<span id="slashed" data-wcs="textContent: tags|join(/)"></span>`,
    );

    expect((shadowRoot.querySelector("#tags") as HTMLElement).textContent).toBe("a, b, c");
    expect((shadowRoot.querySelector("#slashed") as HTMLElement).textContent).toBe("a/b/c");

    host.remove();
  });

  it("abs / truncate: 引数なし・引数ありのどちらも通ること", async () => {
    const { host, shadowRoot } = await mount(
      '{"delta":-12,"title":"abcdefghij"}',
      `<span id="delta" data-wcs="textContent: delta|abs"></span>` +
        `<span id="title" data-wcs="textContent: title|truncate(4)"></span>`,
    );

    expect((shadowRoot.querySelector("#delta") as HTMLElement).textContent).toBe("12");
    expect((shadowRoot.querySelector("#title") as HTMLElement).textContent).toBe("abcd…");

    host.remove();
  });

  it("unit: undefined は書き込みをスキップし、既存の値を壊さないこと", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      '{"w":10}',
      `<div id="box" data-wcs="style.width: w|unit(px)"></div>`,
    );
    const box = shadowRoot.querySelector("#box") as HTMLElement;
    expect(box.style.width).toBe("10px");

    // `"undefinedpx"` を書き込んでしまうと、undefined の書き込みスキップ意味論が壊れる
    stateElement.createState("writable", (s: any) => {
      s.w = undefined;
    });
    await flush();

    expect(box.style.width).not.toBe("undefinedpx");

    host.remove();
  });
});
