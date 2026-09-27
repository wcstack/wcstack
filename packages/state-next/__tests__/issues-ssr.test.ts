/**
 * issues-ssr.test.ts — 現行 @wcstack/state 3.3 の SSR ハイドレーションの Issue
 * （#347 #348 #349 #350 #351 #356 #358）の再現手順を state-next で流す。
 * 各 Issue の「期待」（CSR と同じ表示）を、CSR（enable-ssr なし）と SSR ＋ハイドレーションの両方で確かめる。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes, ssr } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes, ssr]);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`issue-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
    await flush();
  };
  return { root, el, write };
}

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);

/** Renders `html` as the server does (an orchestrated render, then the snapshot builder); its HTML. */
async function serverRender(html: string, state: Record<string, any>, wait = 0): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`issue-server-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
    const out = root.innerHTML;
    h.remove();
    return out;
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
}

/** Loads the server's HTML and hydrates it; `before` sees the page before the state loads. */
async function hydrate(html: string, state: Record<string, any>, before?: (root: ShadowRoot) => void) {
  const h = document.createElement(`issue-client-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  before?.(root);
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
    await flush();
  };
  return { root, write };
}

interface Opts {
  /** How long the page runs before it is read (the server's $connectedCallback). */
  wait?: number;
  /** The client's state (the server's final data); defaults to `state()`. */
  client?: () => Record<string, any>;
  /** SSR: these server nodes must be adopted (still connected after the hydration). */
  adopt?: string;
}
type Loaded = { root: ShadowRoot; write: (fn: (s: any) => void) => Promise<void>; out?: string };
type Load = (html: string, state: () => Record<string, any>, opts?: Opts) => Promise<Loaded>;

/** CSR: the same markup without enable-ssr. */
const csr: Load = async (html, state, opts) => {
  const p = await page(html, state());
  if (opts?.wait) await sleep(opts.wait);
  return p;
};

/** SSR: rendered on the server (`<wcs-state enable-ssr>`), then hydrated on the client. */
const ssrLoad: Load = async (html, state, opts) => {
  const out = await serverRender(`<wcs-state enable-ssr></wcs-state>${html}`, state(), opts?.wait ?? 0);
  expect(out).toContain("<wcs-ssr");
  let serverNodes: Element[] = [];
  const p = await hydrate(out, (opts?.client ?? state)(), (r) => { if (opts?.adopt) serverNodes = Array.from(r.querySelectorAll(opts.adopt)); });
  if (opts?.adopt) {
    expect(serverNodes.length).toBeGreaterThan(0);
    for (const n of serverNodes) expect(n.isConnected).toBe(true);
  }
  return { ...p, out };
};

const modes: [string, Load][] = [["CSR", csr], ["SSR", ssrLoad]];

/** The page's visible text (templates / scripts left out), whitespace collapsed. */
function visible(root: Node): string {
  const out: string[] = [];
  const walk = (n: Node): void => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) out.push((c as Text).data);
      else if (c.nodeType === 1 && !["template", "script", "style"].includes((c as Element).localName)) {
        out.push(" ");
        walk(c);
        out.push(" ");
      }
    }
  };
  walk(root);
  return out.join("").replace(/\s+/g, " ").trim();
}

/** Collects console.error / console.warn while `fn` runs. */
async function capture<T>(fn: () => Promise<T>): Promise<{ result: T; errors: string[]; warns: string[] }> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const msg = (x: unknown[]) => x.map((a) => String((a as Error)?.message ?? a)).join(" ");
  try {
    const result = await fn();
    return { result, errors: error.mock.calls.map(msg), warns: warn.mock.calls.map(msg) };
  } catch (e) {
    // the engine's reports while the steps ran go with a failed assertion
    const errs = error.mock.calls.map(msg);
    if (e instanceof Error && errs.length > 0) e.message += `\n[console.error] ${errs.join(" | ").slice(0, 400)}`;
    throw e;
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
}

// ---------------------------------------------------------------- #347

describe("#347 SSR のハイドレーション後、行テンプレートの直下に if: や {{ }} がある一覧を書き換えても崩れない", () => {
  const lis = (root: ParentNode) => texts(root, "li").join(" ");
  describe.each(modes)("%s", (mode, load) => {
    it("再現 1: 最後の行の if: が真のとき、末尾に足した行が出る", async () => {
      const { root, write } = await load(
        `<ul><template data-wcs="for: items"><li data-wcs="textContent: .n"></li><template data-wcs="if: .show"><li class="x">x</li></template></template></ul>`,
        () => ({ items: [{ n: 1, show: false }, { n: 2, show: true }] }), { adopt: "li" });
      expect(lis(root)).toBe("1 2 x");
      await write((s) => { s.items = [...s.items, { n: 3, show: false }]; });
      expect(lis(root)).toBe("1 2 x 3");
      await write((s) => { s["items.2.show"] = true; });
      expect(lis(root)).toBe("1 2 x 3 x");
    });

    it("再現 1（行が if: だけ）: 末尾に足した行が出る", async () => {
      const { root, write } = await load(
        `<ul><template data-wcs="for: items"><template data-wcs="if: .show"><li data-wcs="textContent: .n"></li></template></template></ul>`,
        () => ({ items: [{ n: 1, show: true }, { n: 2, show: true }] }), { adopt: "li" });
      expect(lis(root)).toBe("1 2");
      await write((s) => { s.items = [...s.items, { n: 3, show: true }]; });
      expect(lis(root)).toBe("1 2 3");
      await write((s) => { s["items.1.show"] = false; });
      expect(lis(root)).toBe("1 3");
    });

    it("対照: 最後の行の if: が偽の一覧に行を足す", async () => {
      const { root, write } = await load(
        `<ul><template data-wcs="for: items"><li data-wcs="textContent: .n"></li><template data-wcs="if: .show"><li class="x">x</li></template></template></ul>`,
        () => ({ items: [{ n: 1, show: true }, { n: 2, show: false }] }), { adopt: "li" });
      expect(lis(root)).toBe("1 x 2");
      await write((s) => { s.items = [...s.items, { n: 3, show: false }]; });
      expect(lis(root)).toBe("1 x 2 3");
    });

    it("サーバー描画の最後に最後の行の if: が偽になっても、末尾に足した行が出る", async () => {
      const { root, write } = await load(
        `<ul><template data-wcs="for: items"><li data-wcs="textContent: .n"></li><template data-wcs="if: .show"><li class="x">x</li></template></template></ul>`,
        () => ({
          items: [{ n: 1, show: false }, { n: 2, show: true }],
          async $connectedCallback(this: any) { await sleep(5); this["items.1.show"] = false; },
        }),
        { wait: 30, client: () => ({ items: [{ n: 1, show: false }, { n: 2, show: false }] }), adopt: "li" });
      expect(lis(root)).toBe("1 2");
      await write((s) => { s.items = [...s.items, { n: 3, show: false }]; });
      expect(lis(root)).toBe("1 2 3");
      await write((s) => { s["items.1.show"] = true; });
      expect(lis(root)).toBe("1 2 x 3");
    });

    it("再現 2: 要素の書き込みで else: の枝がその行に出る（一覧の末尾へ移らない）", async () => {
      const { root, write } = await load(
        `<ul><template data-wcs="for: items"><li data-wcs="textContent: .n"></li><template data-wcs="if: .show"><li class="x">x</li></template><template data-wcs="else:"><li class="y">y</li></template></template></ul>`,
        () => ({ items: [{ n: 1, show: true }, { n: 2, show: true }] }), { adopt: "li" });
      expect(lis(root)).toBe("1 x 2 x");
      await write((s) => { s["items.0"] = { n: 5, show: false }; });
      expect(lis(root)).toBe("5 y 2 x");
      await write((s) => { s["items.0.show"] = true; });
      expect(lis(root)).toBe("5 x 2 x");
    });

    // 以下は Issue の表に無い追加の手順（行の直下の if: の枝が、行の並べ替え・削除で行と一緒に動くか）
    const rowIf = `<ul><template data-wcs="for: items"><li data-wcs="textContent: .n"></li><template data-wcs="if: .show"><li class="x">x</li></template><template data-wcs="else:"><li class="y">y</li></template></template></ul>`;
    it("追加 2a: 行の直下に if / else がある一覧を並べ替える", async () => {
      const { root, write } = await load(rowIf, () => ({ items: [{ n: 1, show: true }, { n: 2, show: false }] }), { adopt: "li" });
      expect(lis(root)).toBe("1 x 2 y");
      await write((s) => { s.items = [...s.items].reverse(); });
      expect(lis(root)).toBe("2 y 1 x");
    });

    it("追加 2b: 行の直下に if / else がある一覧から先頭の行を消す", async () => {
      const { root, write } = await load(rowIf, () => ({ items: [{ n: 1, show: true }, { n: 2, show: false }] }), { adopt: "li" });
      expect(lis(root)).toBe("1 x 2 y");
      await write((s) => { s.items = s.items.slice(1); });
      expect(lis(root)).toBe("2 y");
    });

    it("追加 2c: 行の直下に if / else がある一覧を空にする", async () => {
      const { root, write } = await load(rowIf, () => ({ items: [{ n: 1, show: true }, { n: 2, show: false }] }), { adopt: "li" });
      await write((s) => { s.items = []; });
      expect(lis(root)).toBe("");
    });

    it("再現 3: テキストだけの行（[{{ .n }}]）で、値のテキストが行の外に残らない", async () => {
      const { root, write } = await load(
        `<p><template data-wcs="for: items">[{{ .n }}]</template></p>`,
        () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }));
      const p = () => root.querySelector("p")!.textContent;
      expect(p()).toBe("[1][2][3]");
      await write((s) => { s.items = s.items.slice(1); });
      expect(p()).toBe("[2][3]");
      await write((s) => { s.items = [...s.items].reverse(); });
      expect(p()).toBe("[3][2]");
      await write((s) => { s.items = []; });
      expect(p()).toBe("");
      await write((s) => { s.items = [{ n: 7 }]; });
      expect(p()).toBe("[7]");
    });

    it("再現 3 の手順を 1 つずつ（新しいページで削除 → 空）", async () => {
      const { root, write } = await load(
        `<p><template data-wcs="for: items">[{{ .n }}]</template></p>`,
        () => ({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] }));
      const p = () => root.querySelector("p")!.textContent;
      await write((s) => { s.items = []; });
      expect(p(), mode).toBe("");
    });
  });
});

// ---------------------------------------------------------------- #348

describe("#348 SSR のハイドレーションで、Light DOM の bind-component の子が持つ if: が、ページの外側の else: と組にならない", () => {
  let kid = "";
  beforeAll(() => {
    kid = `issue-kid-${seq++}`;
    customElements.define(kid, class extends HTMLElement { state = {}; });
  });
  const shown = (root: ParentNode) => ({
    A: root.querySelector(".a") !== null,
    X: root.querySelector("i") !== null,
    nX: root.querySelector("s") !== null,
    notA: root.querySelector(".na") !== null,
  });

  describe.each(modes)("%s", (_mode, load) => {
    it("形 1: if の枝の中の子（子の if に else なし）", async () => {
      const html = `
<template data-wcs="if: a">
  <div class="a">A <${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template></${kid}></div>
</template>
<template data-wcs="else:"><p class="na">notA</p></template>`;
      const { root, write } = await load(html, () => ({ a: true, x: true }), { adopt: ".a" });
      expect(shown(root)).toEqual({ A: true, X: true, nX: false, notA: false });
      await write((s) => { s.a = false; });
      expect(shown(root)).toEqual({ A: false, X: false, nX: false, notA: true });
      await write((s) => { s.a = true; });
      expect(shown(root)).toEqual({ A: true, X: true, nX: false, notA: false });
      await write((s) => { s.x = false; });
      expect(shown(root)).toEqual({ A: true, X: false, nX: false, notA: false });
      await write((s) => { s.x = true; });
      expect(shown(root)).toEqual({ A: true, X: true, nX: false, notA: false });
      await write((s) => { s.a = false; });
      expect(shown(root)).toEqual({ A: false, X: false, nX: false, notA: true });
    });

    // 形 1 はページのキーと子のキーがどちらも x。子の if: を誰が束ねたかを見分けるため、ページのキーを y にした形
    it("形 1'（ページのキーを y に: state.x: y）", async () => {
      const html = `
<template data-wcs="if: a">
  <div class="a">A <${kid} data-wcs="state.x: y"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template></${kid}></div>
</template>
<template data-wcs="else:"><p class="na">notA</p></template>`;
      const { errors, result } = await capture(async () => {
        const { root, write } = await load(html, () => ({ a: true, y: true }), { adopt: ".a" });
        const seen = [shown(root)];
        await write((s) => { s.a = false; });
        seen.push(shown(root));
        await write((s) => { s.a = true; });
        seen.push(shown(root));
        await write((s) => { s.y = false; });
        seen.push(shown(root));
        await write((s) => { s.y = true; });
        seen.push(shown(root));
        return seen;
      });
      expect(result).toEqual([
        { A: true, X: true, nX: false, notA: false },
        { A: false, X: false, nX: false, notA: true },
        { A: true, X: true, nX: false, notA: false },
        { A: true, X: false, nX: false, notA: false },
        { A: true, X: true, nX: false, notA: false },
      ]);
      expect(errors).toEqual([]);
    });

    it("対照: 子がページの直下（テンプレートの外）、ページのキーは y", async () => {
      const html = `<div class="a">A <${kid} data-wcs="state.x: y"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template></${kid}></div>`;
      const { errors, result } = await capture(async () => {
        const { root, write } = await load(html, () => ({ y: true }));
        const seen = [shown(root).X];
        await write((s) => { s.y = false; });
        seen.push(shown(root).X);
        await write((s) => { s.y = true; });
        seen.push(shown(root).X);
        return seen;
      });
      expect(result).toEqual([true, false, true]);
      expect(errors).toEqual([]);
    });

    it("形 2: 子の if: に else: がある", async () => {
      const html = `
<template data-wcs="if: a">
  <div class="a">A <${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template><template data-wcs="else:"><s>nX</s></template></${kid}></div>
</template>
<template data-wcs="else:"><p class="na">notA</p></template>`;
      const { root, write } = await load(html, () => ({ a: true, x: true }), { adopt: ".a" });
      expect(shown(root)).toEqual({ A: true, X: true, nX: false, notA: false });
      await write((s) => { s.a = false; });
      expect(shown(root)).toEqual({ A: false, X: false, nX: false, notA: true });
      await write((s) => { s.a = true; });
      expect(shown(root)).toEqual({ A: true, X: true, nX: false, notA: false });
      await write((s) => { s.x = false; });
      expect(shown(root)).toEqual({ A: true, X: false, nX: true, notA: false });
      await write((s) => { s.a = false; });
      expect(shown(root)).toEqual({ A: false, X: false, nX: false, notA: true });
    });

    // 4.0 の意図した差: else: は if: の直後に置く（間に一覧を挟めない）。直後に置いた形は下の形 3'
    it("形 3（Issue のまま）: else: が if: の直後に無いので、初期化が [wcs/template-syntax] #202 で失敗する", async () => {
      const html = `<template data-wcs="if: a"><p class="a">A</p></template><ul><template data-wcs="for: items"><li><${kid} data-wcs="state.x: .x"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template></${kid}></li></template></ul><template data-wcs="else:"><p class="na">notA</p></template>`;
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await expect(load(html, () => ({ a: true, items: [{ x: true }, { x: false }] }))).rejects.toThrow('[wcs/template-syntax] #202 "else"');
      } finally {
        error.mockRestore();
      }
    });

    it("形 3'（else を if の直後へ。子は if の枝の中の for の行）", async () => {
      const html = `<template data-wcs="if: a"><div class="a">A<ul><template data-wcs="for: items"><li><${kid} data-wcs="state.x: .x"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template></${kid}></li></template></ul></div></template><template data-wcs="else:"><p class="na">notA</p></template>`;
      const { root, write } = await load(html, () => ({ a: true, items: [{ x: true }, { x: false }] }), { adopt: "li" });
      expect(shown(root)).toEqual({ A: true, X: true, nX: false, notA: false });
      expect(root.querySelectorAll("i").length).toBe(1);
      await write((s) => { s.a = false; });
      expect(shown(root)).toEqual({ A: false, X: false, nX: false, notA: true });
      await write((s) => { s.a = true; });
      expect(shown(root)).toEqual({ A: true, X: true, nX: false, notA: false });
      await write((s) => { s["items.0.x"] = false; });
      expect(shown(root)).toEqual({ A: true, X: false, nX: false, notA: false });
      await write((s) => { s["items.1.x"] = true; });
      expect(root.querySelectorAll("i").length).toBe(1);
      expect(shown(root)).toEqual({ A: true, X: true, nX: false, notA: false });
      await write((s) => { s.a = false; });
      expect(shown(root)).toEqual({ A: false, X: false, nX: false, notA: true });
    });
  });
});

// ---------------------------------------------------------------- #349

describe("#349 SSR のハイドレーション後、サーバーが描いた枝の中の if 連鎖・3 段の if で 2 つの枝が同時に出ない", () => {
  describe.each(modes)("%s", (_mode, load) => {
    const chain = `<template data-wcs="if: a"><div>A
  <template data-wcs="if: b"><i>B</i></template><template data-wcs="elseif: c"><i>C</i></template><template data-wcs="else:"><s>nBC</s></template>
</div></template>`;

    it("再現 1: 描かれた if: の枝の中の if / elseif / else", async () => {
      const { root, write } = await load(chain, () => ({ a: true, b: false, c: true }), { adopt: "div" });
      expect(visible(root)).toBe("A C");
      await write((s) => { s.c = false; });
      expect(visible(root)).toBe("A nBC");
      await write((s) => { s.b = true; });
      expect(visible(root)).toBe("A B");
      await write((s) => { s.b = false; });
      expect(visible(root)).toBe("A nBC");
      await write((s) => { s.c = true; });
      expect(visible(root)).toBe("A C");
    });

    it("再現 1 の後半: b も c も偽で描き、外側を隠して戻してから c → b", async () => {
      const { root, write } = await load(chain, () => ({ a: true, b: false, c: false }), { adopt: "div" });
      expect(visible(root)).toBe("A nBC");
      await write((s) => { s.a = false; });
      expect(visible(root)).toBe("");
      await write((s) => { s.a = true; });
      expect(visible(root)).toBe("A nBC");
      await write((s) => { s.c = true; });
      expect(visible(root)).toBe("A C");
      await write((s) => { s.b = true; });
      expect(visible(root)).toBe("A B");
    });

    it("再現 2: 要素で包まない 3 段の if:", async () => {
      const { root, write } = await load(
        `<template data-wcs="if: a">A <template data-wcs="if: b">B <template data-wcs="if: c"><i>C</i></template></template></template>`,
        () => ({ a: true, b: true, c: false }));
      expect(visible(root)).toBe("A B");
      await write((s) => { s.c = true; });
      expect(visible(root)).toBe("A B C");
      await write((s) => { s.b = false; });
      expect(visible(root)).toBe("A");
      await write((s) => { s.b = true; });
      expect(visible(root)).toBe("A B C");
      await write((s) => { s.a = false; });
      expect(visible(root)).toBe("");
      await write((s) => { s.a = true; });
      expect(visible(root)).toBe("A B C");
    });

    it("再現 2 の変形: 最も内側に else: を足す", async () => {
      const { root, write } = await load(
        `<template data-wcs="if: a">A <template data-wcs="if: b">B <template data-wcs="if: c"><i>C</i></template><template data-wcs="else:"><s>nC</s></template></template></template>`,
        () => ({ a: true, b: true, c: true }));
      expect(visible(root)).toBe("A B C");
      await write((s) => { s.c = false; });
      expect(visible(root)).toBe("A B nC");
      await write((s) => { s.b = false; });
      expect(visible(root)).toBe("A");
      await write((s) => { s.b = true; });
      expect(visible(root)).toBe("A B nC");
    });

    it("再現 3: 行の中の if / elseif / else", async () => {
      const { root, write } = await load(
        `<ul><template data-wcs="for: items"><li>
  <template data-wcs="if: .a"><i>I</i></template><template data-wcs="elseif: .b"><b>EI</b></template><template data-wcs="else:"><s>E</s></template>
</li></template></ul>`,
        () => ({ items: [{ a: false, b: false }, { a: true, b: false }] }), { adopt: "li" });
      const rows = () => Array.from(root.querySelectorAll("li")).map((li) => visible(li)).join(" / ");
      expect(rows()).toBe("E / I");
      await write((s) => { s["items.0.a"] = true; });
      expect(rows()).toBe("I / I");
      await write((s) => { s["items.0.a"] = false; });
      expect(rows()).toBe("E / I");
      await write((s) => { s["items.0.b"] = true; });
      expect(rows()).toBe("EI / I");
      await write((s) => { s["items.0.a"] = true; });
      expect(rows()).toBe("I / I");
    });
  });
});

// ---------------------------------------------------------------- #350

describe("#350 SSR のハイドレーション後、行の {{ $1 }} がサーバーの添字のまま出る", () => {
  describe.each(modes)("%s", (_mode, load) => {
    it.each([
      ["{{ $1 }}（テキストの束縛）", `<ul><template data-wcs="for: items"><li><b>{{ .id }}</b>:<i>{{ $1 }}</i></li></template></ul>`],
      ["対照: textContent: $1", `<ul><template data-wcs="for: items"><li><b>{{ .id }}</b>:<i data-wcs="textContent: $1"></i></li></template></ul>`],
    ])("%s", async (_name, html) => {
      const { root, write, out } = await load(html, () => ({ items: [{ id: "a" }, { id: "b" }, { id: "c" }] }), { adopt: "li" });
      if (out !== undefined) expect(out).toContain("2");
      expect(texts(root, "li")).toEqual(["a:0", "b:1", "c:2"]);
      await write((s) => { s["items.0.id"] = "A"; });
      expect(texts(root, "li")).toEqual(["A:0", "b:1", "c:2"]);
      await write((s) => { s.items = [...s.items, { id: "d" }]; });
      expect(texts(root, "li")).toEqual(["A:0", "b:1", "c:2", "d:3"]);
      await write((s) => { s.items = s.items.slice(1); });
      expect(texts(root, "li")).toEqual(["b:0", "c:1", "d:2"]);
      await write((s) => { s.items = [...s.items].reverse(); });
      expect(texts(root, "li")).toEqual(["d:0", "c:1", "b:2"]);
    });
  });
});

// ---------------------------------------------------------------- #351

describe("#351 SSR のハイドレーション後、同じ配列を for: items と、それを返す getter の for: で描くページの一覧を書き換えられる", () => {
  const html = `<ul class="i"><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>
<ul class="v"><template data-wcs="for: visible"><li>{{ .name }}</li></template></ul>`;
  const state = () => ({ items: [{ name: "a" }, { name: "b" }], get visible() { return (this as any).items; } });
  const shown = (root: ParentNode) => `${texts(root, "ul.i li").join(" ")} / ${texts(root, "ul.v li").join(" ")}`;
  const results: Record<string, string[]> = {};

  describe.each(modes)("%s", (mode, load) => {
    it("配列ごと書き換える形", async () => {
      const { result, errors } = await capture(async () => {
        const { root, write } = await load(html, state, { adopt: "li" });
        expect(shown(root)).toBe("a b / a b");
        await write((s) => { s.items = [{ name: "z" }, ...s.items.slice(1)]; });
        expect(shown(root)).toBe("z b / z b");
        await write((s) => { s.items = [...s.items, { name: "n" }]; });
        expect(shown(root)).toBe("z b n / z b n");
        return true;
      });
      expect(result).toBe(true);
      expect(errors).toEqual([]);
    });

    it("要素を書き込む形（ul.i は期待どおり、ul.v は CSR と同じ）", async () => {
      const seen: string[] = [];
      const { errors } = await capture(async () => {
        const { root, write } = await load(html, state, { adopt: "li" });
        seen.push(shown(root));
        await write((s) => { s["items.0"] = { name: "z" }; });
        seen.push(shown(root));
        await write((s) => { s.items = [...s.items, { name: "n" }]; });
        seen.push(shown(root));
      });
      results[mode] = seen;
      expect(seen[0]).toBe("a b / a b");
      expect(seen[1].split(" / ")[0]).toBe("z b");
      expect(seen[2]).toBe("z b n / z b n");
      expect(errors).toEqual([]);
    });

    it.each([
      ["対照: 2 つとも for: items", `<ul class="i"><template data-wcs="for: items"><li>{{ .name }}</li></template></ul><ul class="v"><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`, state],
      ["対照: getter が写しを返す", html, () => ({ items: [{ name: "a" }, { name: "b" }], get visible() { return [...(this as any).items]; } })],
    ])("%s", async (_name, h, st) => {
      const { root, write } = await load(h, st, { adopt: "li" });
      expect(shown(root)).toBe("a b / a b");
      await write((s) => { s.items = [{ name: "z" }, ...s.items.slice(1)]; });
      expect(shown(root)).toBe("z b / z b");
      await write((s) => { s.items = [...s.items, { name: "n" }]; });
      expect(shown(root)).toBe("z b n / z b n");
    });
  });

  it("要素を書き込む形: SSR の表示が CSR と同じ", () => {
    expect(results.SSR).toEqual(results.CSR);
  });
});

// ---------------------------------------------------------------- #356

describe("#356 サーバー描画の最後に隠れた if: の中身が要素で包まない if: / for: でも、ハイドレーション後にその if: を真にすると枝が出る", () => {
  const hideLater = (extra: Record<string, any>) => () => ({
    shown: true, count: 0, ...extra,
    async $connectedCallback(this: any) { await sleep(5); this.shown = false; },
  });

  describe.each(modes)("%s", (_mode, load) => {
    it("再現 1: if: の中の if:", async () => {
      const { warns, errors } = await capture(async () => {
        const { root, write } = await load(
          `<div><template data-wcs="if: shown"><template data-wcs="if: inner"><b>B</b></template></template></div>\n<p>{{ count }}</p>`,
          hideLater({ inner: true }), { wait: 30, client: () => ({ shown: false, inner: true, count: 0 }) });
        const b = () => texts(root, "div b").join(" ");
        const p = () => root.querySelector("p")!.textContent;
        expect([b(), p()]).toEqual(["", "0"]);
        await write((s) => { s.count = 1; });
        expect([b(), p()]).toEqual(["", "1"]);
        await write((s) => { s.shown = true; });
        expect([b(), p()]).toEqual(["B", "1"]);
        await write((s) => { s.inner = false; });
        expect(b()).toBe("");
        await write((s) => { s.inner = true; });
        expect(b()).toBe("B");
        await write((s) => { s.shown = false; });
        expect(b()).toBe("");
      });
      expect(warns).toEqual([]);
      expect(errors).toEqual([]);
    });

    it("再現 2: if: の中の for:（警告なし・表示が正しい）", async () => {
      const { warns, errors } = await capture(async () => {
        const { root, write } = await load(
          `<ul><template data-wcs="if: shown"><template data-wcs="for: items"><li data-wcs="textContent: .n"></li></template></template></ul>\n<p>{{ count }}</p>`,
          hideLater({ items: [{ n: 1 }, { n: 2 }] }), { wait: 30, client: () => ({ shown: false, count: 0, items: [{ n: 1 }, { n: 2 }] }) });
        expect(texts(root, "li")).toEqual([]);
        await write((s) => { s.count = 1; });
        expect(root.querySelector("p")!.textContent).toBe("1");
        await write((s) => { s.shown = true; });
        expect(texts(root, "li")).toEqual(["1", "2"]);
        await write((s) => { s.items = [...s.items, { n: 3 }]; });
        expect(texts(root, "li")).toEqual(["1", "2", "3"]);
        await write((s) => { s.shown = false; });
        expect(texts(root, "li")).toEqual([]);
      });
      expect(warns).toEqual([]);
      expect(errors).toEqual([]);
    });

    // 枝のトップレベルが構造のテンプレート 1 つだけの形を避けた変形（枝の先頭にテキスト / 要素を足す）
    it("変形 1: if: の中の if:（枝の先頭にテキスト）", async () => {
      const { errors, result } = await capture(async () => {
        const { root, write } = await load(
          `<div><template data-wcs="if: shown">S <template data-wcs="if: inner"><b>B</b></template></template></div>`,
          hideLater({ inner: true }), { wait: 30, client: () => ({ shown: false, inner: true, count: 0 }) });
        const div = () => visible(root.querySelector("div")!);
        const seen = [div()];
        await write((s) => { s.shown = true; });
        seen.push(div());
        await write((s) => { s.inner = false; });
        seen.push(div());
        await write((s) => { s.inner = true; });
        seen.push(div());
        await write((s) => { s.shown = false; });
        seen.push(div());
        return seen;
      });
      expect(result).toEqual(["", "S B", "S", "S B", ""]);
      expect(errors).toEqual([]);
    });

    it("変形 2: if: の中の for:（枝の先頭に要素）", async () => {
      const { errors, warns, result } = await capture(async () => {
        const { root, write } = await load(
          `<ul><template data-wcs="if: shown"><li>h</li><template data-wcs="for: items"><li data-wcs="textContent: .n"></li></template></template></ul>`,
          hideLater({ items: [{ n: 1 }, { n: 2 }] }), { wait: 30, client: () => ({ shown: false, count: 0, items: [{ n: 1 }, { n: 2 }] }) });
        const seen = [texts(root, "li").join(" ")];
        await write((s) => { s.shown = true; });
        seen.push(texts(root, "li").join(" "));
        await write((s) => { s.shown = false; });
        seen.push(texts(root, "li").join(" "));
        return seen;
      });
      expect(result).toEqual(["", "h 1 2", ""]);
      expect(warns).toEqual([]);
      expect(errors).toEqual([]);
    });

    // 変形 1・2 は、外側を隠すと内側の枝 / 行が残る CSR の不具合にも当たる。内側を空にしてから外側を隠す手順で、
    // SSR の出力の残りだけを見る
    it("変形 3: if: の中の if:（枝の先頭にテキスト、サーバーでは内側が偽）", async () => {
      const { errors, result } = await capture(async () => {
        const { root, write } = await load(
          `<div><template data-wcs="if: shown">S <template data-wcs="if: inner"><b>B</b></template></template></div>`,
          hideLater({ inner: false }), { wait: 30, client: () => ({ shown: false, inner: false, count: 0 }) });
        const div = () => visible(root.querySelector("div")!);
        const seen = [div()];
        await write((s) => { s.shown = true; });
        seen.push(div());
        await write((s) => { s.inner = true; });
        seen.push(div());
        await write((s) => { s.inner = false; });
        seen.push(div());
        await write((s) => { s.shown = false; });
        seen.push(div());
        return seen;
      });
      expect(result).toEqual(["", "S", "S B", "S", ""]);
      expect(errors).toEqual([]);
    });

    it("変形 4: if: の中の for:（枝の先頭に要素、サーバーでは一覧が空）", async () => {
      const { errors, warns, result } = await capture(async () => {
        const { root, write } = await load(
          `<ul><template data-wcs="if: shown"><li>h</li><template data-wcs="for: items"><li data-wcs="textContent: .n"></li></template></template></ul>`,
          hideLater({ items: [] }), { wait: 30, client: () => ({ shown: false, count: 0, items: [] }) });
        const seen = [texts(root, "li").join(" ")];
        await write((s) => { s.shown = true; });
        seen.push(texts(root, "li").join(" "));
        await write((s) => { s.items = [{ n: 1 }, { n: 2 }]; });
        seen.push(texts(root, "li").join(" "));
        await write((s) => { s.items = []; });
        seen.push(texts(root, "li").join(" "));
        await write((s) => { s.shown = false; });
        seen.push(texts(root, "li").join(" "));
        return seen;
      });
      expect(result).toEqual(["", "h", "h 1 2", "h", ""]);
      expect(warns).toEqual([]);
      expect(errors).toEqual([]);
    });

    it.each([
      ["対照: if: が最初から偽（if の中の if）", `<div><template data-wcs="if: shown"><template data-wcs="if: inner"><b>B</b></template></template></div>`, () => ({ shown: false, inner: true }), "div b", ["B"]],
      ["対照: 要素で包んだ for", `<template data-wcs="if: shown"><ul><template data-wcs="for: items"><li data-wcs="textContent: .n"></li></template></ul></template>`, hideLater({ items: [{ n: 1 }, { n: 2 }] }), "li", ["1", "2"]],
      ["対照: 要素で包んだ if", `<template data-wcs="if: shown"><div>A <template data-wcs="if: inner"><b>B</b></template></div></template>`, hideLater({ inner: true }), "div b", ["B"]],
    ])("%s", async (_name, html, st, sel, after) => {
      const { warns } = await capture(async () => {
        const { root, write } = await load(html, st, { wait: 30, client: () => { const s: any = { ...st() }; delete s.$connectedCallback; s.shown = false; return s; } });
        expect(texts(root, sel)).toEqual([]);
        await write((s) => { s.shown = true; });
        expect(texts(root, sel)).toEqual(after);
      });
      expect(warns).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------- #358

describe("#358 SSR のハイドレーションで作った行の spread（...:）が、要素の定義の後も行に追従する", () => {
  const messages: Record<string, { errors: string[]; warns: string[] }> = {};
  const define = (tag: string) => customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }], inputs: [{ name: "name" }] };
    n: unknown;
    set name(v: unknown) { this.n = v; this.textContent = `hello ${v}`; }
    get name(): unknown { return this.n; }
    get status(): string { return "ready"; }
    // happy-dom: a clone of an element made before the definition is upgraded only when it connects
    // (Chromium upgrades it on cloneNode / customElements.upgrade); a value set before that is taken over here
    connectedCallback(): void {
      if (Object.prototype.hasOwnProperty.call(this, "name")) {
        const v = (this as any).name;
        delete (this as any).name;
        this.name = v;
      }
    }
  });

  describe.each(modes)("%s", (mode, load) => {
    it("Issue の手順: 定義 → 葉の書き込み → 削除 → 追加 → 追加した行への書き込み", async () => {
      const tag = `issue-late-${seq++}`;
      const rows = (root: ParentNode) => texts(root, `ul ${tag}`).join(" / ");
      const one = (root: ParentNode) => texts(root, `p ${tag}`).join(" / ");
      const { errors, warns, result } = await capture(async () => {
        const { root, write } = await load(
          `<ul><template data-wcs="for: items"><li><${tag} data-wcs="...: ."></${tag}></li></template></ul>\n<p><${tag} data-wcs="...: one"></${tag}></p>`,
          () => ({ items: [{ name: "a" }, { name: "b" }], one: { name: "z" }, status: "" }), { adopt: "li" });
        const seen = [`${rows(root)} | ${one(root)}`];
        define(tag);
        await flush();
        await flush();
        seen.push(`${rows(root)} | ${one(root)}`);
        await write((s) => { s["items.1.name"] = "B"; });
        seen.push(rows(root));
        await write((s) => { s.items = s.items.slice(1); });
        seen.push(rows(root));
        await write((s) => { s.items = [...s.items, { name: "c" }]; });
        seen.push(rows(root));
        await write((s) => { s["items.1.name"] = "C"; });
        seen.push(rows(root));
        return seen;
      });
      const norm = (xs: string[]) => xs.map((x) => x.split(tag).join("x-late"));
      messages[mode] = { errors: norm(errors), warns: norm(warns) };
      expect(result).toEqual([
        " /  | ",
        "hello a / hello b | hello z",
        "hello a / hello B",
        "hello B",
        "hello B / hello c",
        "hello B / hello C",
      ]);
      expect(errors.filter((e) => /ListIndex|deferred spread failed/.test(e))).toEqual([]);
    });
  });

  it("コンソールの出力（エラー・警告）が SSR と CSR で同じ", () => {
    expect(messages.CSR).toBeDefined();
    expect(messages.SSR).toEqual(messages.CSR);
  });
});
