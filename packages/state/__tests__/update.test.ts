/**
 * update.test.ts — `$update(path, indexes, fn)` (4.16): `$resolve`'s one address, written with
 * `fn(current, ...indexes)`; and the function of `$update` and `$setAll` running at the row it writes:
 * `this.$1` and `this["items.*.x"]` inside it are that row's, not the caller's (until 4.15 a `$setAll`
 * mapper called from a row's handler read the clicked row).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, recursion, scopes } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes, recursion]);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`update-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  return { root, el };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `row ${i}` }));
const ROWS = `<ul><template data-wcs="for: items"><li><a data-wcs="textContent: .label"></a><button data-wcs="onclick: onRow"></button></li></template></ul>`;
const labels = (root: ShadowRoot) => Array.from(root.querySelectorAll("a")).map((a) => a.textContent);

describe("$update は 1 つのアドレスを書き換える", () => {
  it("fn は (今の値, ...添字) で呼ばれ、その戻り値を書く・undefined は書かない・関数でない値はそのまま書く・最上位のパスは []", async () => {
    const { root, el } = await page(`${ROWS}<p>{{ count }}</p>`, { count: 1, items: rows(5) });
    const calls: unknown[] = [];
    let out: unknown = "unset";
    el.createState("writable", (s: any) => {
      out = s.$update("items.*.label", [3], (v: string, i: number) => { calls.push([v, i]); return v + "!"; });
      s.$update("items.*.label", [2], () => undefined);
      s.$update("items.*.label", [4], "four");
      s.$update("count", [], (v: number) => v + 1);
    });
    await flush();
    expect(out).toBeUndefined();
    expect(calls).toEqual([["row 3", 3]]);
    expect(labels(root)).toEqual(["row 0", "row 1", "row 2", "row 3!", "four"]);
    expect(root.querySelector("p")!.textContent).toBe("2");
  });

  it("添字は * 1 本につき 1 つ（#901）・末尾より先の添字は fn を呼ぶ前に no row で throw・** は使えない", () => {
    const e = new Engine({ items: [{ v: 1 }], $recursion: { "nodes.*": "children.*" }, nodes: [] }, new DirtyStrategy());
    expect(() => e.proxy.$update("items.*.v", [], 1)).toThrow('#901 "$update" "items.*.v" 1 0');
    expect(() => e.proxy.$update("items.*.v", [0, 0], 1)).toThrow('#901 "$update" "items.*.v" 1 2');
    const fn = () => { throw new Error("called"); };
    expect(() => e.proxy.$update("items.*.v", [5], fn)).toThrow('#3 "items.*.v"');
    expect(() => e.proxy.$update("nodes.**.v", [], 1)).toThrow('#1101 "nodes.**.v"');
    expect(e.proxy.$resolve("items.*.v", [0])).toBe(1);
  });

  it("再帰 getter の展開形へは、まだ実体化していない深さでも書かない（$setAll・$resolve と同じ）", () => {
    const state = Object.defineProperties(
      { $recursion: { "nodes.*": "children.*" }, nodes: [{ value: 1, children: [{ value: 2, children: [] }] }] },
      Object.getOwnPropertyDescriptors({
        get "nodes.**.total"() { const s = this as any; return s["nodes.**.value"] + s.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0); },
      }),
    );
    const e = new Engine(state, new DirtyStrategy());
    expect(() => e.proxy.$update("nodes.*.children.*.total", [0, 0], 9)).toThrow("[wcs/recursion-readonly]");
    expect(() => e.proxy.$update("nodes.*.total", [0], (v: number) => v + 1)).toThrow("[wcs/recursion-readonly]");
    expect(e.proxy.$resolve("nodes.*.total", [0])).toBe(3);
  });

  it("diagnostics の文は $update を名乗り、添字の本数を $resolve と同じく案内する", async () => {
    const { explain, render } = await import("../src/diagnostics/explain");
    const { M } = await import("../src/messages");
    const message = render(M.IndexArityExact, ["$update", "items.*.v", 1, 0]);
    expect(message).toBe('[wcs/index-arity] $update("items.*.v") takes 1 index(es), got 0.');
    expect(explain(message)).toContain(' $resolve and $update take one index per "*";');
  });
});

describe("mapper は書き込む行の文脈で走る", () => {
  it("行のハンドラから呼んでも、mapper の this.$1 と相対のパスは書き込む行のもの（アロー関数でも function でも）・呼んだ後は元の行に戻る", async () => {
    const seen: Record<string, unknown> = {};
    const { root } = await page(ROWS, {
      items: rows(30),
      onRow(this: any, _e: Event, $1: number) {
        this.$update("items.*.label", [20], (v: string, i: number) => { seen.arrow = [this.$1, i, this["items.*.id"]]; return v + "!"; });
        this.$setAll("items.*.label", [21], function (this: any, v: string) { seen.fn = [this.$1, this["items.*.id"]]; return v + "!"; });
        seen.after = [this.$1, $1, this["items.*.id"]];
      },
    });
    root.querySelectorAll("button")[5].click();
    await flush();
    expect(seen).toEqual({ arrow: [20, 20, 21], fn: [21, 22], after: [5, 5, 6] });
    expect(labels(root).slice(20, 22)).toEqual(["row 20!", "row 21!"]);
  });

  it("入れ子のリストでは $1 と $2 がその行の添字・最上位のパスの関数に行の文脈は無い", async () => {
    const seen: unknown[] = [];
    const { el } = await page(`<template data-wcs="for: groups"><template data-wcs="for: .items"><i data-wcs="textContent: .v"></i></template></template>`, {
      count: 0,
      groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }, { v: 4 }] }],
    });
    el.createState("writable", (s: any) => {
      s.$setAll("groups.*.items.*.v", [1], (v: number) => { seen.push([s.$1, s.$2, v]); return v * 10; });
      s.$update("groups.*.items.*.v", [0, 1], (v: number) => { seen.push([s.$1, s.$2, v]); return v + 100; });
      s.$update("count", [], (v: number) => { seen.push(s.$1); return v + 1; });
    });
    await flush();
    expect(seen).toEqual([[1, 0, 3], [1, 1, 4], [0, 1, 2], undefined]);
    let after: unknown;
    el.createState("readonly", (s: any) => { after = [s.$getAll("groups.*.items.*.v", []), s.count]; });
    expect(after).toEqual([[1, 102, 30, 40], 1]);
  });

  it("関数が throw しても文脈は呼び手のものに戻る・$setAll はそれまでに書いた行を残す", async () => {
    const { el } = await page(ROWS, { items: rows(3) });
    const ctx: unknown[] = [];
    el.createState("writable", (s: any) => {
      expect(() => s.$setAll("items.*.label", [], (v: string, i: number) => { if (i === 1) throw new Error("boom"); return v + "!"; })).toThrow("boom");
      ctx.push(s.$1);
      expect(() => s.$update("items.*.label", [2], () => { throw new Error("bang"); })).toThrow("bang");
      ctx.push(s.$1);
    });
    let after: unknown;
    el.createState("readonly", (s: any) => { after = s.$getAll("items.*.label", []); });
    expect(ctx).toEqual([undefined, undefined]);
    expect(after).toEqual(["row 0!", "row 1", "row 2"]);
  });
});

describe("$update の周り", () => {
  it("readonly の createState・getter の中・createStateAsync は $setAll と同じく拒み、関数を呼ばない", async () => {
    const called: string[] = [];
    const { el } = await page(`${ROWS}<p>{{ bad }}</p>`, {
      items: rows(2),
      get bad() {
        try {
          (this as any).$update("items.*.label", [0], () => called.push("getter"));
          return "written";
        } catch (e) {
          return (e as Error).message.includes("#8") ? "readonly" : String(e);
        }
      },
    });
    expect(() => el.createState("readonly", (s: any) => s.$update("items.*.label", [0], () => called.push("readonly")))).toThrow("#8");
    expect(called).toEqual([]);
    let bad: unknown;
    el.createState("readonly", (s: any) => { bad = s.bad; });
    expect(bad).toBe("readonly");
    const out: string[] = [];
    await el.createStateAsync("readonly", async (s: any) => {
      await 0;
      try {
        s.$update("items.*.label", [0], (v: string) => v + "x");
        out.push("written");
      } catch (e) {
        out.push((e as Error).message.includes("#8") ? "readonly" : String(e));
      }
    });
    expect(out).toEqual(["readonly"]);
  });

  it("volume の中ではパスがマウントからの相対で、mapper の this はアロー関数なら volume のまま", async () => {
    const h = document.createElement(`update-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><wcs-state mount="cart"></wcs-state><template data-wcs="for: cart.items"><b data-wcs="textContent: .qty"></b></template>`;
    const [rootEl, vol] = Array.from(root.querySelectorAll("wcs-state")) as any[];
    rootEl.setInitialState({});
    vol.setInitialState({
      items: [{ qty: 1, step: 2 }, { qty: 5, step: 3 }],
      bump(this: any, i: number) {
        this.$update("items.*.qty", [i], (v: number) => v + this["items.*.step"]);
      },
    });
    document.body.appendChild(h);
    await Promise.all([rootEl.connectedCallbackPromise, vol.connectedCallbackPromise]);
    await getBindingsReady(root);
    await flush();
    rootEl.createState("writable", (s: any) => { s["cart.bump"](1); });
    await flush();
    expect(Array.from(root.querySelectorAll("b")).map((b) => b.textContent)).toEqual(["1", "8"]);
  });
});
