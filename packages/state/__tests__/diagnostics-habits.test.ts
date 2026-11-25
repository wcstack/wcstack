/**
 * What another framework's habits write, and nothing reported (docs/seam-apps.md, street-reports — a React team's
 * app moved to wcstack): `{{ }}` in an attribute value, `if:` / `for:` on an element that is not a `<template>`,
 * `style:` given an object, an expression where a path belongs.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, diagnostics } from "../src/index";

let seq = 0;

beforeAll(() => {
  installFeatures([diagnostics]);
  bootstrapState();
});

/** A page whose `setTimeout` is faked: the look comes 5 s after the page is ready. */
async function bound(html: string, state: Record<string, any>) {
  const h = document.createElement(`habit-test-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  return { root, el };
}

describe("ほかのフレームワークの習慣（docs/seam-apps.md、street-reports）", () => {
  let warn: MockInstance<typeof console.warn>;
  const said = (code: string) => warn.mock.calls.map((c) => String(c[0])).filter((w) => w.includes(`[wcs/${code}]`));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    warn.mockRestore();
  });

  it("属性値の中の {{ }} は書いたまま残る: タグと属性ごとに 1 回知らせる。描かれた行の中も見る", async () => {
    const { root } = await bound(
      `<a href="/reports/{{ id }}">one</a><a href="/other/{{ id }}">two</a><img alt="{{ title }}">`
      + `<ul><template data-wcs="for: items"><li class="row {{ .kind }}">{{ .t }}</li></template></ul>`,
      { id: 12, title: "穴", items: [{ kind: "a", t: "x" }, { kind: "b", t: "y" }] },
    );
    expect(root.querySelector("a")!.getAttribute("href")).toBe("/reports/{{ id }}");
    await vi.advanceTimersByTimeAsync(4999);
    expect(said("attribute-mustache")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(said("attribute-mustache")).toEqual([
      '[@wcstack/state] [wcs/attribute-mustache] <a href="/reports/{{ id }}">: {{ }} is read in text only; here it stays as written. Bind it: data-wcs="attr.href: <path>".',
      '[@wcstack/state] [wcs/attribute-mustache] <img alt="{{ title }}">: {{ }} is read in text only; here it stays as written. Bind it: data-wcs="attr.alt: <path>".',
      '[@wcstack/state] [wcs/attribute-mustache] <li class="row {{ .kind }}">: {{ }} is read in text only; here it stays as written. Bind it: data-wcs="attr.class: <path>".',
    ]);
  });

  it("<template> でない要素の if: / for: は何もしない: タグと指定ごとに 1 回知らせる。<template> と data-wcs-ignore の中は言わない", async () => {
    const { root } = await bound(
      `<p id="p" data-wcs="if: open">always</p><p data-wcs=" if : open">again</p>`
      + `<ul><li id="li" data-wcs="for: items">row</li></ul>`
      + `<template data-wcs="if: open"><b>ok</b></template>`
      + `<div data-wcs-ignore><p data-wcs="if: open" title="{{ t }}">theirs</p></div>`,
      { open: false, t: "x", items: [1, 2] },
    );
    expect(root.querySelector("#p")!.isConnected).toBe(true);
    expect(root.querySelectorAll("li")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(said("structural-element")).toEqual([
      '[@wcstack/state] [wcs/structural-element] <p data-wcs="if: open">: "if:" works on a <template> only; here it does nothing. Wrap the element in <template data-wcs="if: …">.',
      '[@wcstack/state] [wcs/structural-element] <li data-wcs="for: items">: "for:" works on a <template> only; here it does nothing. Wrap the element in <template data-wcs="for: …">.',
    ]);
    expect(said("attribute-mustache")).toEqual([]);
  });

  it("どちらも無いページは何も言わない（{{ を含まない属性、ふつうの束縛）", async () => {
    await bound(`<a href="/reports/12" data-wcs="attr.title: t; class.on: open">x</a><p>{{ t }}</p>`, { open: true, t: "x" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(said("attribute-mustache").concat(said("structural-element"))).toEqual([]);
  });

  it("style: にオブジェクトを渡すと要素は style を持たない: 束縛ごとに 1 回知らせる。文字列と null は言わない", async () => {
    const { root, el } = await bound(
      `<p id="o" data-wcs="style: bar"></p><p id="s" data-wcs="style: css"></p><p id="n" data-wcs="style: none"></p><p id="w" data-wcs="style.width: width"></p>`,
      { pct: 40, css: "width: 40%", none: null, width: "40%", get bar() { return { width: `${this.pct}%` }; } },
    );
    expect(said("style-object")).toEqual([
      '[@wcstack/state] [wcs/style-object] "style: bar" on <p> is given an object: the element keeps no style. Bind each property (style.width: <path>, a string with its unit) or a CSS string (attr.style: <path>).',
    ]);
    expect((root.querySelector("#w") as HTMLElement).style.width).toBe("40%");
    // a second object for the same binding is not said again
    el.createState("writable", (s: any) => { s.pct = 50; });
    await Promise.resolve();
    await Promise.resolve();
    expect(said("style-object")).toHaveLength(1);
  });
});

describe("パスの所に式（docs/seam-apps.md、street-reports）", () => {
  const thrown = (path: string) => {
    const e = new Engine({ count: 2, loading: false, items: [] }, new DirtyStrategy());
    try {
      (e.proxy as any)[path];
    } catch (x) {
      return String((x as Error).message);
    }
    return "";
  };

  it.each([
    ["!loading"],
    ["count + 1"],
    ["count === 2"],
    ["loading ? 'a' : 'b'"],
    ["format(count)"],
    ["`n${count}`"],
    ["loading && count"],
  ])("式には、近い名前ではなく「式はパスではない」と言う（%s）", (path) => {
    const message = thrown(path);
    expect(message).toContain(`Path "${path}" does not exist on the state tree. An expression is not a path: use a filter (|not, |eq(x), |gt(n)) or a getter.`);
    expect(message).not.toContain("Did you mean");
  });

  it("名前の誤字には今までどおり近い名前を言う", () => {
    expect(thrown("cout")).toContain('Path "cout" does not exist on the state tree. Did you mean "count"?');
    expect(thrown("zzz")).not.toContain("expression");
  });
});
