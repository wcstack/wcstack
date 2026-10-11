/**
 * fixes-diagnostics.test.ts — F11（docs/state-engine-rewrite/v4-remaining.ja.md §2.5）: wcBindable の
 * プロパティのイベントを既定の getter（e.detail）で読むとき、形の食い違いを警告する（診断の後付け）。
 */
import { it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, diagnostics, getBindingsReady, installFeatures } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  installFeatures([diagnostics]);
  bootstrapState();
});

it("F11 detail が無い・detail が { <prop>: … } の包み を、要素 × プロパティごとに 1 回だけ警告する。書き込みはそのまま行う", async () => {
  const tag = "fix-detail-el";
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "value", event: `${tag}:value` }, { name: "ping", event: `${tag}:ping`, semantics: "event" }],
      inputs: [{ name: "value" }],
    };
    value: unknown = 5;
    ping: unknown = 1;
  });
  const h = document.createElement("fix-detail-page");
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state><${tag} class="a" data-wcs="value: a; ping: p"></${tag}><${tag} class="b" data-wcs="value: b"></${tag}>`;
  const state = root.querySelector("wcs-state") as any;
  state.setInitialState({ a: 5, b: 5, p: 0 });
  document.body.appendChild(h);
  await state.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  const read = (path: string) => {
    let v: unknown;
    state.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  const a = root.querySelector(".a") as any;
  const b = root.querySelector(".b") as any;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    a.dispatchEvent(new Event(`${tag}:value`));
    a.dispatchEvent(new Event(`${tag}:value`));
    expect(read("a")).toBeUndefined();
    b.value = 7;
    b.dispatchEvent(new CustomEvent(`${tag}:value`, { detail: { value: 7 } }));
    expect(read("b")).toEqual({ value: 7 });
    // an occurrence carries any payload, and the conforming shape has nothing to say
    a.dispatchEvent(new Event(`${tag}:ping`));
    b.dispatchEvent(new CustomEvent(`${tag}:value`, { detail: 8 }));
    const said = warn.mock.calls.map((c) => String(c[0]));
    const tail = "With no getter, state receives e.detail as-is. Dispatch the value itself as detail, or declare getter (e.g. (e) => e.detail.value, or (e) => e.target.value) on that wcBindable property.";
    expect(said).toEqual([
      `[@wcstack/state] [wcs/default-getter-mismatch] <${tag}> "value": the event carried no detail (undefined) while element.value is number. ${tail}`,
      `[@wcstack/state] [wcs/default-getter-mismatch] <${tag}> "value": the event's detail is an object with a "value" key while element.value is number. ${tail}`,
    ]);
  } finally {
    warn.mockRestore();
  }
});

it("F17 数値添字の行の getter（items.0.double）は「宣言されていない」と警告しない。打ち間違いは行の getter も候補に挙げる", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const h = document.createElement("fix-f17-page");
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ items.0.double }}</p><p>{{ items.0.doubel }}</p>`;
    const state = root.querySelector("wcs-state") as any;
    state.setInitialState({ items: [{ v: 1 }], get "items.*.double"() { return (this as any)["items.*.v"] * 2; } });
    document.body.appendChild(h);
    await state.connectedCallbackPromise;
    await getBindingsReady(root);
    await new Promise((r) => setTimeout(r, 10));
    expect(root.querySelector("p")!.textContent).toBe("2");
    const said = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("binding-path-missing"));
    expect(said).toEqual([
      '[@wcstack/state] [wcs/binding-path-missing] Bound path "items.0.doubel" does not resolve on the state tree: "doubel" is not declared. Did you mean "double"? Updates to this path will be silently dropped. Validate statically: npx @wcstack/lint <file>.',
    ]);
  } finally {
    warn.mockRestore();
  }
});

it("substr は 4.0 で外した: 未知のフィルタとして失敗し、slice(start, start + length) への書き換えを案内する", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const h = document.createElement("fix-substr-page");
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ name|substr(1,3) }}</p>`;
    const state = root.querySelector("wcs-state") as any;
    state.setInitialState({ name: "hello" });
    document.body.appendChild(h);
    await expect(state.connectedCallbackPromise).rejects.toThrow(
      '[@wcstack/state] [wcs/filter-unknown] filter not found: substr. "substr" was removed in 4.0 — write slice(start, start + length): slice takes the end index, not a length.',
    );
  } finally {
    error.mockRestore();
  }
});
