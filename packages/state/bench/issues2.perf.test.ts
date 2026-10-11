/**
 * issues2.perf.test.ts — the measurements behind the check of @wcstack/state 3.3's issues #385, #389,
 * #390 and #391 against state-next (docs/state-engine-rewrite/v4-remaining.ja.md §8, 2026-09-28).
 * Timings in happy-dom: not part of the unit suite (they take minutes and depend on the machine).
 *   npx vitest run --config bench/vitest.perf.config.ts
 * The numbers are printed ([obs] lines and tables); the assertions only check how they scale.
 */
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures } from "../src/index";
import { ALL_FEATURES } from "../src/features/all";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures(ALL_FEATURES);
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`perf-page-${seq++}`);
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
  return { host: h, root, el, write };
}

/** A component whose `<wcs-state bind-component="state">` sits in its shadow root. */
function component(markup: string, state: () => Record<string, any>): string {
  const tag = `perf-cmp-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    state = state();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${markup}`;
    }
  });
  return tag;
}

/** Printed whether the test passes or not. */
const log = (...a: unknown[]) => { process.stdout.write(`${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n`); };
const note = (label: string, o: unknown) => log(`[obs] ${label}: ${JSON.stringify(o)}`);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const fmt = (ms: number) => `${ms.toFixed(3)} ms`;

// ---------------------------------------------------------------- #389

/** 要素の書き込みを `n` 回（1 回ずつ別のバッチ）行い、1 回あたりの同期部分の時間。 */
function perWrite(el: any, n: number, fn: (s: any, i: number) => void): number {
  const engine = el.engine;
  const ts: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    el.createState("writable", (s: any) => fn(s, i));
    ts.push(performance.now() - t0);
    engine.drain();
  }
  return median(ts);
}

describe("#389 要素の書き込みの費用が、行の下で読んだパスの種類の数に比例するか", () => {
  const dynamic = async (K: number, withFor: boolean) => {
    const m: Record<string, number> = {};
    for (let i = 0; i < K; i++) m["k" + i] = i;
    const { el } = await page(withFor ? `<template data-wcs="for: items"><p>x</p></template>` : `<p>x</p>`, { items: [{ m }, { m: { ...m } }] });
    el.createState("readonly", (s: any) => { for (let i = 0; i < K; i++) s.$resolve("items.*.m.k" + i, [0]); });
    const engine = el.engine;
    const under = engine.patterns.peek("items.*.m")?.children.length ?? 0;
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) runs.push(perWrite(el, 20, (s) => { const o = s["items.0"]; s["items.0"] = o; }));
    return { ms: median(runs), under };
  };

  const res: Record<string, number> = {};

  it("行の下の動的なキー: K = 0 / 1,000 / 10,000 / 100,000（Issue の規模 K = 10,000 で 0.5 ms 未満）", async () => {
    const rows: string[] = [];
    for (const withFor of [false, true]) {
      for (const K of [0, 1000, 10000, 100000]) {
        const { ms, under } = await dynamic(K, withFor);
        res[`${withFor}-${K}`] = ms;
        rows.push(`| ${withFor ? "for: items" : "for 無し"} | ${K} | ${fmt(ms)} | ${under} |`);
      }
    }
    log(["#389 行の下の動的なキー（要素の書き込み 1 回、同期部分、5 回の中央値）", "| 形 | K | 1 回 | items.*.m の下のパターン |", ...rows].join("\n"));
    // Issue の期待: K に依らない（3.3 の修正前 0.06 ms）。K = 10,000 で 0.5 ms を超えない
    expect(res["false-10000"]).toBeLessThan(0.5);
    expect(res["true-10000"]).toBeLessThan(0.5);
  }, 60000);

  // Issue の期待（K に依らない）は、4.0 でも満たさない（v4-remaining §8 の #389）: 比を記録するだけ
  it("K = 100,000 と K = 0 の比（Issue の期待は、K に比例しないこと）", () => {
    note("#389 K = 100,000 / K = 0", { noFor: res["false-100000"] / res["false-0"], withFor: res["true-100000"] / res["true-0"] });
  });

  it("（参考）同じ仕組みのほかの形: getter が動的なキーを読む・一覧の置き換え・ルートのオブジェクトの動的なキー", async () => {
    const lines: string[] = [];
    for (const K of [0, 1000, 10000, 100000]) {
      const m: Record<string, number> = {};
      for (let i = 0; i < K; i++) m["k" + i] = i;
      // (a) 行の getter が、そのときのキーだけを読む。キーを K 回替えた後（辺は読まなくなっても残る）
      const a = await page(`<template data-wcs="for: items"><p>{{ .pick }}</p></template>`, {
        items: [{ m }, { m: { ...m } }],
        key: "k0",
        get "items.*.pick"() { return (this as any)["items.*.m." + (this as any).key]; },
      });
      for (let i = 1; i < K; i++) { a.el.createState("writable", (s: any) => { s.key = "k" + i; }); a.el.engine.drain(); }
      const pickEl = median([0, 1, 2, 3, 4].map(() => perWrite(a.el, 20, (s) => { const o = s["items.0"]; s["items.0"] = o; })));
      // (b) 一覧の置き換え（同じ要素の写し）: K 個の行の下のパターンの上で
      const b = await page(`<p>x</p>`, { items: [{ m }, { m: { ...m } }] });
      b.el.createState("readonly", (s: any) => { for (let i = 0; i < K; i++) s.$resolve("items.*.m.k" + i, [0]); });
      const replace = median([0, 1, 2, 3, 4].map(() => perWrite(b.el, 20, (s) => { s.items = [...s.items]; })));
      // (c) ルートのオブジェクト: this["dict.k<i>"] を K 種類読んだ後、dict を書き戻す
      const c = await page(`<p>x</p>`, { dict: { ...m } });
      c.el.createState("readonly", (s: any) => { for (let i = 0; i < K; i++) void s["dict.k" + i]; });
      // eslint-disable-next-line no-self-assign -- writes the same object back (a write, through the proxy)
      const dict = median([0, 1, 2, 3, 4].map(() => perWrite(c.el, 20, (s) => { s.dict = s.dict; })));
      lines.push(`| ${K} | ${fmt(pickEl)} | ${fmt(replace)} | ${fmt(dict)} | ${a.el.engine.patterns.peek("items.*.m")?.children.length ?? 0} |`);
    }
    log(["#389 参考（1 回、同期部分、5 回の中央値）", "| K | (a) getter が動的なキーを読んだ後の要素の書き込み | (b) 一覧の置き換え | (c) ルートの dict の書き戻し | (a) の items.*.m の下のパターン |", ...lines].join("\n"));
    expect(lines.length).toBe(4);
  }, 120000);

  it("普通の形（1,000 行、1 つのバッチで 1 万回書く）", async () => {
    const N = 1000;
    const W = 10000;
    const mk = () => Array.from({ length: N }, (_, i) => ({ name: "n" + i }));
    const getAll = { get all() { return (this as any).$getAll("items.*.name", []).length; } };
    const fresh = (s: any, j: number) => { s[`items.${j % N}`] = { name: "x" + j }; };
    // eslint-disable-next-line no-self-assign -- writes the same object back (a write, through the proxy)
    const same = (s: any, j: number) => { const k = `items.${j % N}`; s[k] = s[k]; };
    const leaf = (s: any, j: number) => { s[`items.${j % N}.name`] = "x" + j; };
    const readAll = (s: any) => { for (let i = 0; i < N; i++) void s[`items.${i}.name`]; };
    const mkPage = async (markup: string, extra: Record<string, any>, prep: ((s: any) => void) | null) => {
      const state = Object.defineProperties({ items: mk() }, Object.getOwnPropertyDescriptors(extra));
      const { el } = await page(markup, state);
      if (prep !== null) el.createState("readonly", prep);
      el.engine.drain();
      return el;
    };
    const pGetAll = await mkPage(`<p>{{ all }}</p>`, getAll, null);
    const pRead = await mkPage(`<p>x</p>`, {}, readAll);
    const pBare = await mkPage(`<p>x</p>`, {}, null);
    const pFor = await mkPage(`<template data-wcs="for: items"><p>{{ .name }}</p></template>`, {}, null);
    const cases: [string, string, any, (s: any, j: number) => void][] = [
      ["for 無し・$getAll の getter を描く", "要素を新しいオブジェクトで", pGetAll, fresh],
      ["同上", "同じオブジェクトを書き戻して", pGetAll, same],
      ["同上", "葉", pGetAll, leaf],
      ["for 無し・行を 1 回読んだだけ", "要素を新しいオブジェクトで", pRead, fresh],
      ["同上", "同じオブジェクトを書き戻して", pRead, same],
      ["（基準）for 無し・何も読まない", "要素を新しいオブジェクトで", pBare, fresh],
      ["同上", "同じオブジェクトを書き戻して", pBare, same],
      ["同上", "葉", pBare, leaf],
      ["for: items で {{ .name }}（対照）", "要素を新しいオブジェクトで", pFor, fresh],
    ];
    const runs: number[][] = cases.map(() => []);
    // 形を交互に測る（ほかの負荷の揺れを形の間で揃える）
    for (let r = 0; r < 15; r++) {
      cases.forEach(([, , el, op], k) => {
        const t0 = performance.now();
        el.createState("writable", (s: any) => { for (let j = 0; j < W; j++) op(s, j); });
        runs[k].push(performance.now() - t0);
        el.engine.drain();
      });
    }
    const out = cases.map(([a, b], k) => `| ${a} | ${b} | ${fmt(median(runs[k]))} |`);
    log(["#389 普通の形（1,000 行、1 バッチで 1 万回、同期部分、形を交互に 15 回の中央値）", "| 形 | 操作 | state-next |", ...out].join("\n"));
    expect(out.length).toBe(cases.length);
  }, 60000);
});

// ---------------------------------------------------------------- #390

describe("#390 外側の行の位置が変わる更新の費用が、入れ子の行の数に比例するか", () => {
  const OUTER = 3000;
  let id = 0;
  const shapes: Record<string, { markup: string; mk: () => any }> = {
    flat: { markup: `<div>{{ .n }}</div>`, mk: () => ({ n: id++ }) },
    nestPlain: { markup: `<div>{{ .n }}<template data-wcs="for: .it"><i>{{ .v }}</i></template></div>`, mk: () => ({ n: id++, it: [{ v: 1 }, { v: 2 }, { v: 3 }] }) },
    nestPlain20: { markup: `<div>{{ .n }}<template data-wcs="for: .it"><i>{{ .v }}</i></template></div>`, mk: () => ({ n: id++, it: Array.from({ length: 20 }, (_, v) => ({ v })) }) },
    deepPlain: {
      markup: `<div><template data-wcs="for: .it"><section><template data-wcs="for: .jt"><i>{{ .v }}</i></template></section></template></div>`,
      mk: () => ({ n: id++, it: [{ jt: [{ v: 1 }, { v: 2 }] }, { jt: [{ v: 3 }, { v: 4 }] }] }),
    },
    nestIdx: { markup: `<div>{{ .n }}<template data-wcs="for: .it"><i>{{ $1 }}</i></template></div>`, mk: () => ({ n: id++, it: [{ v: 1 }, { v: 2 }, { v: 3 }] }) },
  };
  const measure = async (shape: string, op: "prepend" | "dropFirst") => {
    const { markup, mk } = shapes[shape];
    const { el, root } = await page(`<div id="host"><template data-wcs="for: rows">${markup}</template></div>`, { rows: Array.from({ length: OUTER }, mk) });
    const engine = el.engine;
    const ts: number[] = [];
    for (let r = 0; r < 21; r++) {
      const t0 = performance.now();
      el.createState("writable", (s: any) => { s.rows = op === "prepend" ? [mk(), ...s.rows] : s.rows.slice(1); });
      engine.drain();
      ts.push(performance.now() - t0);
      // 行の数を保つ
      el.createState("writable", (s: any) => { s.rows = op === "prepend" ? s.rows.slice(1) : [mk(), ...s.rows]; });
      engine.drain();
    }
    return { ms: median(ts), root };
  };

  it("外側 3,000 行の prepend / dropFirst（書き込み＋drain、21 回の中央値）", async () => {
    const res: Record<string, number> = {};
    const lines: string[] = [];
    for (const shape of Object.keys(shapes)) {
      for (const op of ["prepend", "dropFirst"] as const) {
        const { ms } = await measure(shape, op);
        res[`${shape}-${op}`] = ms;
        lines.push(`| ${shape} | ${op} | ${fmt(ms)} |`);
      }
    }
    log(["#390 外側 3,000 行（書き込み＋drain の同期部分、21 回の中央値）", "| 形 | 操作 | state-next |", ...lines].join("\n"));
    // 入れ子に添字の束縛が無ければ、入れ子の行の数（3 → 20、2 段）に比例しない
    for (const op of ["prepend", "dropFirst"]) {
      expect(res[`nestPlain20-${op}`]).toBeLessThan(res[`nestPlain-${op}`] * 2 + 0.5);
      expect(res[`deepPlain-${op}`]).toBeLessThan(res[`nestPlain-${op}`] * 2 + 0.5);
    }
  }, 60000);
});

// ---------------------------------------------------------------- #385

describe("#385 for: の行に完全マウントした部品が私有キーを描いていても、リストの置き換えは行数に比例する", () => {
  type Form = "state: . + 私有キー + $connectedCallback" | "state: . + 私有キー（$connectedCallback なし）" | "state: .（私有キーを描かない）" | "state.name: .name + 私有キー + $connectedCallback";
  const cmpOf = (form: Form): string => {
    if (form === "state: .（私有キーを描かない）") return component(`<span>{{ name }}</span>`, () => ({ seen: "-" }));
    if (form === "state: . + 私有キー（$connectedCallback なし）") return component(`<span>{{ name }}</span><i>{{ seen }}</i>`, () => ({ seen: "-" }));
    return component(`<span>{{ name }}</span><i>{{ seen }}</i>`, () => ({ seen: "-", $connectedCallback(this: any) { this.seen = "saw " + this.name; } }));
  };

  /** Renders N rows, replaces them 3 times (with `users = []` in between, or not), timing each until the last row shows. */
  async function run(form: Form, n: number, clear: boolean) {
    const tag = cmpOf(form);
    const wiring = form.startsWith("state.name") ? "state.name: .name" : "state: .";
    const { root, el, host } = await page(`<div><template data-wcs="for: users"><${tag} data-wcs="${wiring}"></${tag}></template></div>`, { users: [] });
    const make = (round: number) => Array.from({ length: n }, (_, i) => ({ name: `r${round}-${i}` }));
    const expectLast = (round: number): [string, string | null] => {
      const name = `r${round}-${n - 1}`;
      if (form === "state: .（私有キーを描かない）") return [name, null];
      if (form === "state: . + 私有キー（$connectedCallback なし）") return [name, "-"];
      return [name, `saw ${name}`];
    };
    const box = root.querySelector("div")!;
    /** O(1): the last row element shows its name (and private key). */
    const lastShows = (round: number): boolean => {
      const last = box.lastElementChild;
      const sr = last?.shadowRoot;
      if (!sr) return false;
      const [name, seen] = expectLast(round);
      return sr.querySelector("span")?.textContent === name && (seen === null || sr.querySelector("i")?.textContent === seen);
    };
    /** Every row shows its own name (and its private key). */
    const allShow = (round: number): boolean => {
      const els = root.querySelectorAll(tag);
      if (els.length !== n) return false;
      for (let i = 0; i < n; i++) {
        const sr = (els[i] as Element).shadowRoot!;
        const name = `r${round}-${i}`;
        if (sr.querySelector("span")?.textContent !== name) return false;
        const seen = expectLast(round)[1] === null ? null : expectLast(round)[1]!.startsWith("saw") ? `saw ${name}` : "-";
        if (seen !== null && sr.querySelector("i")?.textContent !== seen) return false;
      }
      return true;
    };
    const times: number[] = [];
    const clears: number[] = [];
    for (let round = 1; round <= 3; round++) {
      if (clear && round > 1) {
        const c0 = performance.now();
        el.createState("writable", (s: any) => { s.users = []; });
        for (let k = 0; k < 100000 && root.querySelectorAll(tag).length !== 0; k++) await flush();
        clears.push(Math.round(performance.now() - c0));
        await flush();
      }
      const rows = make(round);
      const t0 = performance.now();
      el.createState("writable", (s: any) => { s.users = rows; });
      // microtasks first (the drain and the components' mounts run in microtasks), then macrotasks
      let m = 0;
      while (!lastShows(round) && m++ < 200000) await Promise.resolve();
      let k = 0;
      while (!lastShows(round) && k++ < 100000) await flush();
      const tLast = performance.now();
      k = 0;
      while (!allShow(round) && k++ < 100000) await flush();
      times.push(Math.round(tLast - t0));
      if (k > 0) note(`#385 ${form} N=${n} round ${round}: 最後の行の後に、全行がそろうまで ${k} マクロタスク`, {});
      expect(allShow(round)).toBe(true);
    }
    const r0 = performance.now();
    host.remove();
    await flush();
    const removeMs = Math.round(performance.now() - r0);
    if (clears.length > 0 || removeMs > 0) note(`#385 ${form} N=${n} 空にする / host.remove`, { clears, removeMs });
    return times;
  }

  const results: Record<string, Record<number, number[]>> = {};

  const sizes = [250, 500, 1000];
  const forms: Form[] = ["state: . + 私有キー + $connectedCallback", "state.name: .name + 私有キー + $connectedCallback"];
  for (const form of forms) {
    for (const n of sizes) {
      it(`${form} / ${n} 行（1 回目 / 2 回目 / 3 回目、間に users = []）`, async () => {
        const times = await run(form, n, true);
        (results[form] ??= {})[n] = times;
        note(`#385 ${form} N=${n}`, times);
      }, 60000);
    }
  }

  it("state: . + 私有キー + $connectedCallback / 2000 行", async () => {
    const times = await run("state: . + 私有キー + $connectedCallback", 2000, true);
    (results["state: . + 私有キー + $connectedCallback"] ??= {})[2000] = times;
    note("#385 state: . + 私有キー + $connectedCallback N=2000", times);
  }, 60000);

  it("その他の形（1000 行）: $connectedCallback なし・私有キーを描かない・間に [] を挟まない", async () => {
    const a = await run("state: . + 私有キー（$connectedCallback なし）", 1000, true);
    const b = await run("state: .（私有キーを描かない）", 1000, true);
    const c = await run("state: . + 私有キー + $connectedCallback", 1000, false);
    const d = await run("state.name: .name + 私有キー + $connectedCallback", 1000, false);
    note("#385 その他の形 N=1000", { noCallback: a, noPrivateRendered: b, noClear: c, partialNoClear: d });
  }, 60000);

  it("伸び方: 完全マウントの 2 回目・3 回目の置き換えは、行数に比例する（1000 行 / 250 行 が 8 倍未満）", () => {
    const r = results["state: . + 私有キー + $connectedCallback"];
    const p = results["state.name: .name + 私有キー + $connectedCallback"];
    note("#385 まとめ", { whole: r, partial: p });
    expect(r?.[250] && r?.[1000]).toBeTruthy();
    const second = r[1000][1] / Math.max(1, r[250][1]);
    const third = r[1000][2] / Math.max(1, r[250][2]);
    note("#385 比（1000 行 / 250 行）", { second, third, first: r[1000][0] / Math.max(1, r[250][0]) });
    expect(second).toBeLessThan(8);
    expect(third).toBeLessThan(8);
  });
});

// ---------------------------------------------------------------- #391

describe("#391 自己再帰の部品の木（for: children の行に state: .）: マウントと葉の 100 回の更新、再評価は祖先の経路に限る", () => {
  async function mountTree(depth: number, onEvaluate: (label: string) => void) {
    const tag = `perf-tree-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      state = {
        open: false,
        get total(): number {
          const self = this as any;
          onEvaluate(self.label);
          const kids: unknown[] = self.$getAll("children.*.total") ?? [];
          return (Number(self.value) || 0) + kids.reduce<number>((a, b) => a + (Number(b) || 0), 0);
        },
      };
      // happy-dom constructs the elements of a template's content: the markup goes in on connect
      connectedCallback() {
        const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        if (root.firstChild === null) {
          root.innerHTML = `<wcs-state bind-component="state"></wcs-state>`
            + `<span class="label" data-wcs="textContent: label"></span>`
            + `<span class="total" data-wcs="textContent: total"></span>`
            + `<ul><template data-wcs="for: children"><li><${tag} data-wcs="state: ."></${tag}></li></template></ul>`;
        }
      }
    });
    const tree = (level: number, label: string): object => ({
      label, value: 1,
      children: level === depth ? [] : Array.from({ length: 3 }, (_, i) => tree(level + 1, `${label}.${i}`)),
    });
    const nodes = (3 ** (depth + 1) - 1) / 2;
    const t0 = performance.now();
    const p = await page(`<${tag} data-wcs="state: root"></${tag}>`, { root: tree(0, "r") });
    const rootEl = p.root.querySelector(tag) as HTMLElement;
    const totalOf = () => rootEl.shadowRoot?.querySelector(".total")?.textContent ?? null;
    const kidsOf = (n: HTMLElement) => Array.from(n.shadowRoot!.querySelectorAll(`ul > li > ${tag}`)) as HTMLElement[];
    if (harness33) {
      // 3.3 のテストと同じ待ち方: 各ノードの <wcs-state> の初期化を待ち、1 マクロタスク譲ってから子へ
      const settle = async (n: HTMLElement): Promise<void> => {
        const st = n.shadowRoot!.querySelector("wcs-state") as any;
        await st.connectedCallbackPromise;
        await getBindingsReady(n.shadowRoot!);
        await flush();
        for (const c of kidsOf(n)) await settle(c);
      };
      await settle(rootEl);
      await flush(); await flush(); await flush();
    } else {
      let k = 0;
      while ((totalOf() !== String(nodes) || p.root.querySelectorAll(tag).length === 0) && k++ < 100000) await flush();
    }
    const count = (n: ParentNode): number => Array.from(n.querySelectorAll(tag)).reduce((a, e) => a + 1 + count((e as Element).shadowRoot!), 0);
    const mountMs = performance.now() - t0;
    return { ...p, tag, nodes, totalOf, mountMs, count: count(p.root) };
  }
  let harness33 = false;

  const cases = [2, 3, 5].flatMap((d) => [[d, "3.3 と同じ待ち方（ノードごとに 1 マクロタスク、更新ごとに 2 マクロタスク）"], [d, "エンジンの時間（終わるまでだけ待つ）"]] as const);
  it.each(cases)("深さ %i・分岐 3 / %s", async (depth, how) => {
    harness33 = how.startsWith("3.3");
    const evaluations: string[] = [];
    const t = await mountTree(depth, (label) => evaluations.push(label));
    try {
      expect(t.count).toBe(t.nodes);
      expect(t.totalOf()).toBe(String(t.nodes));
      const ancestorPath = new Set(Array.from({ length: depth + 1 }, (_, level) => `r${".0".repeat(level)}`));
      const leaf = `root${".children.0".repeat(depth)}.value`;
      let maxEvaluations = 0;
      let microtasks = 0;
      const outside: string[] = [];
      const t1 = performance.now();
      for (let update = 1; update <= 100; update++) {
        evaluations.length = 0;
        if (harness33) {
          await t.write((s) => { s[leaf] = update + 1; });
        } else {
          t.el.createState("writable", (s: any) => { s[leaf] = update + 1; });
          let m = 0;
          while (t.totalOf() !== String(t.nodes + update) && m++ < 200) await Promise.resolve();
          microtasks = Math.max(microtasks, m);
          let k = 0;
          while (t.totalOf() !== String(t.nodes + update) && k++ < 1000) await flush();
        }
        expect(t.totalOf()).toBe(String(t.nodes + update));
        for (const e of evaluations) if (!ancestorPath.has(e)) outside.push(e);
        maxEvaluations = Math.max(maxEvaluations, evaluations.length);
        expect(new Set(evaluations)).toEqual(ancestorPath);
      }
      const updateMs = performance.now() - t1;
      note(`#391 深さ ${depth} / ${how}`, { nodes: t.nodes, mountMs: Math.round(t.mountMs), updateMs: Math.round(updateMs), maxEvaluationsPerUpdate: maxEvaluations, bound: 2 * (depth + 1), microtasksPerUpdate: harness33 ? "-" : microtasks, outside: outside.slice(0, 5) });
      expect(maxEvaluations).toBeLessThanOrEqual(2 * (depth + 1));
    } finally {
      t.host.remove();
    }
  }, 60000);

  it("（参考）この環境の 1 マクロタスク（setTimeout 0）の長さ", async () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) await flush();
    note("#391 flush 1 回", { ms: (performance.now() - t0) / 200 });
  });
});
