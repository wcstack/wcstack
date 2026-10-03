/**
 * regression-3x-shared-inner.test.ts — @wcstack/state 3.4.0 で直した「複数の外側の行が同じ内側の配列を持つ」形の修正
 * （#379・#393・#394）と、3.4 の既知の制限（#396・#397・#398）、#365（同じ行オブジェクト）の回帰テストの形を
 * state-next（4.0）で流す。
 *
 * 移したもの: 3.x の packages/state/__tests__ の integration.sharedInnerListReplace / sharedInnerListRebind /
 * sharedInnerListReplace.cost（振る舞いだけ — 時間・読みの回数は見ない）/ sharedRowObject / divergentLedgerReplacement
 * （修正で変わった it の観察できる部分）。状態の値・描いた文字・$watch・console.error だけを見る（3.x の台帳・行の索引は見ない）。
 *
 * #396・#397・#398 は 3.4 が誤る（または描き損ねる）形で、ここには正しい期待を書く。4.0 の要素の書き込みは位置の値を
 * 差し替える（行は値と一緒に動かない — migration-v4 §3.4）が、値と描いた文字は 3.x と同じになるはず。
 *
 * 既に issues2-lists.test.ts の #379 にある形（Issue の手順・行のボタン・行 1 を通して最初に書く・行 getter で行 0 を
 * 通した書き込み・葉だけ・外側の一覧の写し・外側の行を足す）は繰り返さない。4.0 の既知の制限 F26（同じオブジェクトが
 * 2 つの一覧から届く — migration-v4 §5・issues-lists.test.ts #365）に当たる部分は、期待から外してコメントで示す。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, scopes, ssr, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, scopes, ssr]);
  bootstrapState();
});

type Page = Awaited<ReturnType<typeof page>>;

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`regression-3x-shared-inner-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  return handles(root, el, h);
}

function handles(root: ShadowRoot, el: any, host: HTMLElement) {
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
    await flush();
  };
  /** Reads with `fn` inside a readonly state. */
  const snap = <T>(fn: (s: any) => T): T => {
    let v!: T;
    el.createState("readonly", (s: any) => { v = fn(s); });
    return v;
  };
  return { root, el, write, snap, host };
}

/** Renders `html` as the server does (an orchestrated render, then the snapshot builder); its HTML. */
async function serverRender(html: string, state: Record<string, any>): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`regression-3x-shared-inner-server-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
    const out = root.innerHTML;
    h.remove();
    return out;
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
}

/** Loads the server's HTML and hydrates it. */
async function hydrate(html: string, state: Record<string, any>) {
  const h = document.createElement(`regression-3x-shared-inner-client-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  return handles(root, el, h);
}

/** Collects console.error while `fn` runs (the messages). */
async function errorsOf(fn: () => Promise<void>): Promise<string[]> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await fn();
    return spy.mock.calls.map((c) => c.map((a) => String((a as Error)?.message ?? a)).join(" "));
  } finally {
    spy.mockRestore();
  }
}

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);
const click = async (n: Element) => { (n as HTMLElement).click(); await flush(); await flush(); };

const GROUPS =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template></div></template>`;
const GROUPS_IF =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="if: .show">` +
  `<template data-wcs="for: .items"><span>{{ .v }}</span></template></template></div></template>`;
const GROUPS_TAGS =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items">` +
  `<span>{{ .v }}[<template data-wcs="for: .tags"><em>{{ .t }}</em></template>]</span></template></div></template>`;
const GROUPS_TAGS_IF =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="if: .show"><template data-wcs="for: .items">` +
  `<span>{{ .v }}[<template data-wcs="for: .tags"><em>{{ .t }}</em></template>]</span></template></template></div></template>`;
/** Two keys of one outer row (`.items` in <span>, `.alt` in <b>). */
const DUAL =
  `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template>` +
  `<template data-wcs="for: .alt"><b>{{ .v }}</b></template></div></template>`;

/** The inner rows' text per outer row, joined with `,` (an outer row hidden by `if:` is empty). */
const view = (root: ParentNode): string[] =>
  Array.from(root.querySelectorAll("div.g")).map((g) => texts(g, "span").join(","));
/** `view` for DUAL: `items|alt`. */
const viewDual = (root: ParentNode): string[] =>
  Array.from(root.querySelectorAll("div.g")).map((g) => `${texts(g, "span").join(",")}|${texts(g, "b").join(",")}`);
/** The state's values, in the shape of `view` (hidden outer rows too). */
const stateOf = (p: Page): string[] =>
  p.snap((s) => s.groups.map((g: any) => g.items.map((x: any) => x.v).join(",")));
/** The state's values, in the shape of `viewDual`. */
const stateDual = (p: Page): string[] =>
  p.snap((s) => s.groups.map((g: any) => `${g.items.map((x: any) => x.v).join(",")}|${g.alt.map((x: any) => x.v).join(",")}`));
/** The state of a three-level (`.tags`) list, in the shape of `view`. */
const deepStateOf = (p: Page): string[] =>
  p.snap((s) => s.groups.map((g: any) => g.items.map((x: any) => `${x.v}[${x.tags.map((t: any) => t.t).join("")}]`).join(",")));

const L = (...values: string[]) => values.map((v) => ({ v }));
const shared = (...values: string[]) => {
  const inner = L(...values);
  return { groups: [{ items: inner }, { items: inner }] };
};
const item = (v: string, ...tags: string[]) => ({ v, tags: tags.map((t) => ({ t })) });
const rebuild = (s: any) => { s.groups = s.groups.map((g: any) => ({ ...g })); };

// ---------------------------------------------------------------- #379

describe("#379 共有した内側の配列の要素を差し替えると、その配列を描くどの for も描き直す（修正の形）", () => {
  it("揃わない書き込み（同じ配列の別の要素を置く）の後に新しい要素を書いても、両方の外側の行に出る", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b", "c"));
      await p.write((s) => { s["groups.0.items.0"] = s["groups.0.items.2"]; });
      expect(view(p.root)).toEqual(["c,b,c", "c,b,c"]);
      await p.write((s) => { s["groups.0.items.0"] = { v: "N" }; });
      expect(view(p.root)).toEqual(["N,b,c", "N,b,c"]);
    });
    expect(errors).toEqual([]);
  });

  it("同じ位置をもう片方の外側の行を通して差し替え直し、その下に葉を書いても、両方の外側の行に出る", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b"));
      await p.write((s) => { s["groups.0.items.1"] = { v: "B" }; });
      await p.write((s) => { s["groups.1.items.1"] = { v: "C" }; });
      expect(view(p.root)).toEqual(["a,C", "a,C"]);
      await p.write((s) => { s["groups.1.items.1.v"] = "Q"; });
      expect(view(p.root)).toEqual(["a,Q", "a,Q"]);
      expect(stateOf(p)).toEqual(["a,Q", "a,Q"]);
    });
    expect(errors).toEqual([]);
  });

  // 4.0 の要素の書き込みは位置の値の差し替え（行は動かない — migration-v4 §3.4）。値と描いた文字は 3.x と同じ
  it("入れ替え（1 つのバッチ・2 つのバッチ）の後、両方の外側の行が入れ替えた並びを描く", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b", "c"));
      await p.write((s) => {
        const first = s["groups.0.items.0"];
        s["groups.0.items.0"] = s["groups.0.items.2"];
        s["groups.0.items.2"] = first;
      });
      expect(view(p.root)).toEqual(["c,b,a", "c,b,a"]);
      let held: unknown;
      await p.write((s) => { held = s["groups.1.items.0"]; s["groups.1.items.0"] = s["groups.1.items.1"]; });
      await p.write((s) => { s["groups.1.items.1"] = held; });
      expect(view(p.root)).toEqual(["b,c,a", "b,c,a"]);
      await p.write((s) => { s["groups.0.items.0.v"] = "X"; });
      expect(view(p.root)).toEqual(["X,c,a", "X,c,a"]);
      expect(stateOf(p)).toEqual(["X,c,a", "X,c,a"]);
    });
    expect(errors).toEqual([]);
  });

  it("3 段: 同じ外側の行の兄弟・別の外側の行のいとこが同じ tags を持つとき、差し替えと葉が共有した全部の行に出る", async () => {
    const errors = await errorsOf(async () => {
      const tags = () => [{ t: "x" }, { t: "y" }];
      const siblingTags = tags();
      const cousinTags = tags();
      const p = await page(GROUPS_TAGS, {
        groups: [
          { items: [{ v: "a", tags: siblingTags }, { v: "b", tags: siblingTags }, { v: "c", tags: cousinTags }] },
          { items: [{ v: "d", tags: cousinTags }] },
        ],
      });
      await p.write((s) => { s["groups.0.items.1.tags.0"] = { t: "X" }; });
      expect(view(p.root)).toEqual(["a[Xy],b[Xy],c[xy]", "d[xy]"]);
      await p.write((s) => { s["groups.0.items.0.tags.0.t"] = "W"; });
      expect(view(p.root)).toEqual(["a[Wy],b[Wy],c[xy]", "d[xy]"]);
      await p.write((s) => { s["groups.1.items.0.tags.1"] = { t: "Y" }; });
      expect(view(p.root)).toEqual(["a[Wy],b[Wy],c[xY]", "d[xY]"]);
      await p.write((s) => { s["groups.0.items.2.tags.1.t"] = "Q"; });
      expect(view(p.root)).toEqual(["a[Wy],b[Wy],c[xQ]", "d[xQ]"]);
    });
    expect(errors).toEqual([]);
  });

  it("if で隠した外側の行は、戻したときに差し替えた後の並びを描き、その後の葉にも追従する", async () => {
    const errors = await errorsOf(async () => {
      const inner = L("a", "b");
      const p = await page(GROUPS_IF, { groups: [{ show: true, items: inner }, { show: true, items: inner }] });
      await p.write((s) => { s["groups.1.show"] = false; });
      await p.write((s) => { s["groups.0.items.1"] = { v: "B" }; });
      await p.write((s) => { s["groups.1.show"] = true; });
      expect(view(p.root)).toEqual(["a,B", "a,B"]);
      await p.write((s) => { s["groups.1.items.1.v"] = "Q"; });
      expect(view(p.root)).toEqual(["a,Q", "a,Q"]);
    });
    expect(errors).toEqual([]);
  });

  it("行 getter（for: .shown）で描く共有の配列を、2 つ目の外側の行を通して差し替えても両方の外側の行に出る（3.4 は最初に描いた外側の行だけ）", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(
        `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .shown"><span>{{ .v }}</span></template></div></template>`,
        { ...shared("a", "b", "c"), get "groups.*.shown"() { return (this as any)["groups.*.items"]; } },
      );
      await p.write((s) => { s["groups.1.items.1"] = { v: "B" }; });
      expect(stateOf(p)).toEqual(["a,B,c", "a,B,c"]);
      expect(view(p.root)).toEqual(["a,B,c", "a,B,c"]);
    });
    expect(errors).toEqual([]);
  });

  it("同じ配列を別のパス（other.*.items）の for も描いていれば、そちらも描き直す", async () => {
    const errors = await errorsOf(async () => {
      const inner = L("a", "b", "c");
      const p = await page(
        GROUPS + `<template data-wcs="for: other"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template></div></template>`,
        { groups: [{ items: inner }, { items: inner }], other: [{ items: inner }] },
      );
      await p.write((s) => { s["other.0.items.0"] = { v: "N" }; });
      await p.write((s) => { s["groups.0.items.1"] = { v: "M" }; });
      expect(view(p.root)).toEqual(["N,M,c", "N,M,c", "N,M,c"]);
    });
    expect(errors).toEqual([]);
  });

  it("描かれない外側の行で投げる行 getter（data: null）があっても、共有の配列への書き込みは投げずに描かれる", async () => {
    const errors = await errorsOf(async () => {
      const inner = L("a", "b");
      const p = await page(
        `<template data-wcs="for: groups"><div class="g"><template data-wcs="if: .data">` +
        `<template data-wcs="for: .items"><span>{{ .v }}</span></template></template></div></template>`,
        {
          groups: [{ data: { items: inner } }, { data: null }, { data: { items: inner } }],
          get "groups.*.items"() { return (this as any)["groups.*.data"].items; },
        },
      );
      expect(() => p.el.createState("writable", (s: any) => { s["groups.0.items.1"] = { v: "N" }; })).not.toThrow();
      await flush();
      await flush();
      expect(view(p.root)).toEqual(["a,N", "", "a,N"]);
    });
    expect(errors).toEqual([]);
  });

  // 3.x #379 の修正の形は「$watch("groups.*.items.*") は書いた位置で 1 回」（3.x は [["B", 0, 1]]）。4.0 は意図して変えた:
  // 同じ配列を持つ外側の行の位置ごとに 1 回ずつ呼ぶ（その配列を持つどのパスの値も変わったため — migration-v4 §3.4）。
  // engine.ts の mirror() が共有するほかの一覧の行ごとに landed() → hooks.written を呼び、temporal/watch.ts の written() が
  // それぞれを hit にする
  it("$watch(\"groups.*.items.*\") は配列を持つ外側の行ごとに 1 回（3.x は書いた位置で 1 回）、2 つのバッチの入れ替えもそれぞれのバッチで同じく呼ばれる", async () => {
    const watched: [string, number, number][] = [];
    const p = await page(GROUPS, {
      ...shared("a", "b", "c"),
      $watch: { "groups.*.items.*"(cur: any, _prev: unknown, g: number, r: number) { watched.push([cur.v, g, r]); } },
    });
    await p.write((s) => { s["groups.0.items.1"] = { v: "B" }; });
    expect(watched).toEqual([["B", 0, 1], ["B", 1, 1]]);
    watched.length = 0;
    let first: unknown;
    await p.write((s) => { first = s["groups.0.items.0"]; s["groups.0.items.0"] = s["groups.0.items.2"]; });
    expect(watched).toEqual([["c", 0, 0], ["c", 1, 0]]);
    watched.length = 0;
    await p.write((s) => { s["groups.0.items.2"] = first; });
    expect(watched).toEqual([["a", 0, 2], ["a", 1, 2]]);
    expect(view(p.root)).toEqual(["c,B,a", "c,B,a"]);
  });
});

describe("#379 共有していた配列を写しに替えた後の差し替え（写しと元の配列にそれぞれ着地する）", () => {
  it("写して足した後に元の配列の要素を差し替え、写し側の葉に書く", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b", "c"));
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "d" }]; });
      await p.write((s) => { s["groups.0.items.0"] = { v: "N" }; });
      expect(view(p.root)).toEqual(["N,b,c", "a,b,c,d"]);
      await p.write((s) => { s["groups.1.items.0.v"] = "Z"; });
      expect(stateOf(p)).toEqual(["N,b,c", "Z,b,c,d"]);
      expect(view(p.root)).toEqual(["N,b,c", "Z,b,c,d"]);
    });
    expect(errors).toEqual([]);
  });

  it("そのままの写しに替えた後に元の配列の要素を差し替え、写し側の葉に書く", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b", "c"));
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"]]; });
      await p.write((s) => { s["groups.0.items.2"] = { v: "N" }; });
      expect(view(p.root)).toEqual(["a,b,N", "a,b,c"]);
      await p.write((s) => { s["groups.1.items.2.v"] = "Z"; });
      expect(stateOf(p)).toEqual(["a,b,N", "a,b,Z"]);
      expect(view(p.root)).toEqual(["a,b,N", "a,b,Z"]);
    });
    expect(errors).toEqual([]);
  });

  it("slice で外側の行 0 を写し、その写しの要素を差し替える", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b", "c"));
      await p.write((s) => { s["groups.0.items"] = s["groups.0.items"].slice(0, 2); });
      await p.write((s) => { s["groups.0.items.0"] = { v: "N" }; });
      expect(stateOf(p)).toEqual(["N,b", "a,b,c"]);
      expect(view(p.root)).toEqual(["N,b", "a,b,c"]);
    });
    expect(errors).toEqual([]);
  });
});

describe("#379 共有しない 3 段の入れ子で、差し替えで外した要素を別の外側の行へ移す", () => {
  const board = () => ({ groups: [{ items: [item("a", "a1"), item("b", "b1", "b2")] }, { items: [item("c", "c1")] }] });

  it("同じバッチで差し替えて、外した要素を別の外側の行に置く", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS_TAGS, board());
      await p.write((s) => {
        const moved = s["groups.0.items.1"];
        s["groups.0.items.1"] = item("N", "n1");
        s["groups.1.items.0"] = moved;
      });
      expect(view(p.root)).toEqual(["a[a1],N[n1]", "b[b1b2]"]);
      expect(deepStateOf(p)).toEqual(["a[a1],N[n1]", "b[b1b2]"]);
    });
    expect(errors).toEqual([]);
  });

  it("差し替えと、外した要素を置く書き込みを 2 つのバッチに分ける", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS_TAGS, board());
      let moved: unknown;
      await p.write((s) => { moved = s["groups.0.items.1"]; s["groups.0.items.1"] = item("N", "n1"); });
      await p.write((s) => { s["groups.1.items.0"] = moved; });
      expect(view(p.root)).toEqual(["a[a1],N[n1]", "b[b1b2]"]);
    });
    expect(errors).toEqual([]);
  });

  it("外した要素を別の外側の行の配列に足してから差し替える（同じバッチ）", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS_TAGS, board());
      await p.write((s) => {
        const moved = s["groups.0.items.1"];
        s["groups.1.items"] = [...s["groups.1.items"], moved];
        s["groups.0.items.1"] = item("N", "n1");
      });
      expect(view(p.root)).toEqual(["a[a1],N[n1]", "c[c1],b[b1b2]"]);
    });
    expect(errors).toEqual([]);
  });

  it("差し替えた次のバッチで外した要素を足し、その子の葉に書くと、移した要素の子に着地して描かれる", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS_TAGS, board());
      let moved: unknown;
      await p.write((s) => { moved = s["groups.0.items.1"]; s["groups.0.items.1"] = item("N", "n1"); });
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"], moved]; });
      expect(view(p.root)).toEqual(["a[a1],N[n1]", "c[c1],b[b1b2]"]);
      await p.write((s) => { s["groups.1.items.1.tags.0.t"] = "Z"; });
      expect(deepStateOf(p)).toEqual(["a[a1],N[n1]", "c[c1],b[Zb2]"]);
      expect(view(p.root)).toEqual(["a[a1],N[n1]", "c[c1],b[Zb2]"]);
    });
    expect(errors).toEqual([]);
  });
});

describe("#379 外側の行を作り直した後の差し替え（内側の行が新しい外側の行へ付け替わる形 — #256）", () => {
  const plain = () => ({ groups: [{ items: L("a", "b", "c") }, { items: L("d", "e", "f") }] });

  it("外側の行を写し直した後、同じ行の位置を順に差し替えても描き直される", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, plain());
      await p.write(rebuild);
      await p.write((s) => { s["groups.0.items.1"] = { v: "N" }; });
      expect(view(p.root)).toEqual(["a,N,c", "d,e,f"]);
      await p.write((s) => { s["groups.0.items.0"] = { v: "M" }; });
      expect(view(p.root)).toEqual(["M,N,c", "d,e,f"]);
      await p.write((s) => { s["groups.1.items.2"] = { v: "P" }; });
      expect(view(p.root)).toEqual(["M,N,c", "d,e,P"]);
      expect(stateOf(p)).toEqual(["M,N,c", "d,e,P"]);
    });
    expect(errors).toEqual([]);
  });

  it("作り直して逆順にした後・共有した外側の行を 1 つ消した後も描き直される", async () => {
    const errors = await errorsOf(async () => {
      const reversed = await page(GROUPS, plain());
      await reversed.write((s) => { s.groups = s.groups.map((g: any) => ({ ...g })).reverse(); });
      await reversed.write((s) => { s["groups.0.items.1"] = { v: "N" }; });
      await reversed.write((s) => { s["groups.0.items.0"] = { v: "M" }; });
      expect(view(reversed.root)).toEqual(["M,N,f", "a,b,c"]);

      const sharedPage = await page(GROUPS, shared("a", "b"));
      await sharedPage.write((s) => { s.groups = s.groups.filter((_: unknown, k: number) => k !== 0); });
      await sharedPage.write((s) => { s["groups.0.items.1"] = { v: "N" }; });
      await sharedPage.write((s) => { s["groups.0.items.0"] = { v: "M" }; });
      expect(view(sharedPage.root)).toEqual(["M,N"]);
    });
    expect(errors).toEqual([]);
  });

  it("3 段: 内側の行を写し直した後、その下のリストの要素を差し替えても描き直される", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS_TAGS, { groups: [{ items: [item("a", "x", "y"), item("b", "z")] }] });
      await p.write((s) => { s["groups.0.items"] = s["groups.0.items"].map((i: any) => ({ ...i })); });
      await p.write((s) => { s["groups.0.items.0.tags.1"] = { t: "Q" }; });
      await p.write((s) => { s["groups.0.items.0.tags.0"] = { t: "R" }; });
      expect(view(p.root)).toEqual(["a[RQ],b[z]"]);
    });
    expect(errors).toEqual([]);
  });

  it("SSR のハイドレーションの後に外側の行を作り直しても、差し替えが描き直される", async () => {
    const errors = await errorsOf(async () => {
      const html = await serverRender(`<wcs-state enable-ssr></wcs-state>${GROUPS}`, plain());
      expect(html).toContain("<wcs-ssr");
      const p = await hydrate(html, plain());
      expect(view(p.root)).toEqual(["a,b,c", "d,e,f"]);
      await p.write(rebuild);
      await p.write((s) => { s["groups.0.items.1"] = { v: "N" }; });
      await p.write((s) => { s["groups.0.items.0"] = { v: "M" }; });
      expect(view(p.root)).toEqual(["M,N,c", "d,e,f"]);
      p.host.remove();
    });
    expect(errors).toEqual([]);
  });
});

describe("#379 同じバッチで、共有していた外側の行の配列を替える", () => {
  it("別の配列に替えて差し替え、元の配列へ戻すと、戻した外側の行も差し替えを描く", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b", "c"));
      await p.write((s) => {
        const inner = s["groups.0.items"];
        s["groups.1.items"] = [{ v: "y" }];
        s["groups.0.items.1"] = { v: "N" };
        s["groups.1.items"] = inner;
      });
      expect(view(p.root)).toEqual(["a,N,c", "a,N,c"]);
      await p.write((s) => { s["groups.0.items.2"] = { v: "P" }; });
      expect(view(p.root)).toEqual(["a,N,P", "a,N,P"]);
    });
    expect(errors).toEqual([]);
  });

  it("別の配列に替えたまま差し替えても、替えた外側の行はその配列を描き、後で同じ配列に戻すと差し替えが両方に出る", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b", "c"));
      await p.write((s) => { s["groups.1.items"] = [{ v: "y" }]; s["groups.0.items.1"] = { v: "N" }; });
      expect(view(p.root)).toEqual(["a,N,c", "y"]);
      await p.write((s) => { s["groups.1.items"] = s["groups.0.items"]; });
      await p.write((s) => { s["groups.1.items.0"] = { v: "Q" }; });
      expect(view(p.root)).toEqual(["Q,N,c", "Q,N,c"]);
    });
    expect(errors).toEqual([]);
  });

  it("差し替えた後、同じバッチで同じ中身の写しに替えても描き直され、その後の元の配列への差し替えは写しに出ない", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b", "c"));
      await p.write((s) => { s["groups.1.items.1"] = { v: "N" }; s["groups.1.items"] = [...s["groups.1.items"]]; });
      expect(view(p.root)).toEqual(["a,N,c", "a,N,c"]);
      await p.write((s) => { s["groups.0.items.2"] = { v: "P" }; });
      expect(stateOf(p)).toEqual(["a,N,P", "a,N,c"]);
      expect(view(p.root)).toEqual(["a,N,P", "a,N,c"]);
    });
    expect(errors).toEqual([]);
  });
});

describe("#379 / #393 外側の行を作り直した後、共有していた配列の要素を差し替え、写しに替えて書く（書き込みが別の配列に着地しない）", () => {
  const cases: [string, ((s: any) => void)[], string[]][] = [
    ["外側の行 1 を通して差し替え、外側の行 1 を写しに替えて書く", [
      rebuild,
      (s) => { s["groups.1.items.0"] = { v: "v30" }; },
      (s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "v34" }]; s["groups.1.items.0"] = { v: "v36" }; },
    ], ["v30,v1", "v36,v1,v34"]],
    ["外側の行 1 を通して差し替え、外側の行 0 を写しに替えて書く", [
      rebuild,
      (s) => { s["groups.1.items.0"] = { v: "v30" }; },
      (s) => { s["groups.0.items"] = [...s["groups.0.items"], { v: "v34" }]; s["groups.0.items.0"] = { v: "v36" }; },
    ], ["v36,v1,v34", "v30,v1"]],
    ["同じ配列を持つ外側の行を足してから差し替え、写しに替えて書く（バッチを分ける）", [
      rebuild,
      (s) => { s.groups = [...s.groups, { items: s["groups.1.items"] }]; },
      (s) => { s["groups.2.items.0"] = { v: "v30" }; },
      (s) => { s["groups.2.items"] = [...s["groups.2.items"], { v: "v34" }]; },
      (s) => { s["groups.2.items.0"] = { v: "v36" }; },
    ], ["v30,v1", "v30,v1", "v36,v1,v34"]],
    ["先頭に足した写しに替えて書く", [
      rebuild,
      (s) => { s["groups.1.items.0"] = { v: "v30" }; },
      (s) => { s["groups.1.items"] = [{ v: "n" }, ...s["groups.1.items"]]; s["groups.1.items.1"] = { v: "v36" }; },
    ], ["v30,v1", "n,v36,v1"]],
    ["filter の写しに替えて書く", [
      rebuild,
      (s) => { s["groups.1.items.0"] = { v: "v30" }; },
      (s) => { s["groups.1.items"] = s["groups.1.items"].filter(() => true); s["groups.1.items.0"] = { v: "v36" }; },
    ], ["v30,v1", "v36,v1"]],
  ];

  it.each(cases)("%s", async (_label, steps, expected) => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("v0", "v1"));
      for (const fn of steps) await p.write(fn);
      expect(stateOf(p)).toEqual(expected);
      expect(view(p.root)).toEqual(expected);
    });
    expect(errors).toEqual([]);
  });

  it("if の中でも、写しに替えて書いた値が写しに着地する", async () => {
    const errors = await errorsOf(async () => {
      const inner = L("v0", "v1");
      const p = await page(GROUPS_IF, { groups: [{ show: true, items: inner }, { show: true, items: inner }] });
      await p.write(rebuild);
      await p.write((s) => { s["groups.1.items.0"] = { v: "v30" }; });
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "v34" }]; s["groups.1.items.0"] = { v: "v36" }; });
      expect(stateOf(p)).toEqual(["v30,v1", "v36,v1,v34"]);
      expect(view(p.root)).toEqual(["v30,v1", "v36,v1,v34"]);
    });
    expect(errors).toEqual([]);
  });

  it("外側の行の入れ替えと同じバッチで差し替え、別の外側の行を写しに替えてから、また差し替える", async () => {
    const errors = await errorsOf(async () => {
      const inner = L("v0", "v1", "v2");
      const p = await page(GROUPS_IF, { groups: [0, 1, 2, 3].map(() => ({ show: true, items: inner })) });
      await p.write((s) => { s.groups = [...s.groups, { show: true, items: s["groups.0.items"] }]; });
      await p.write((s) => { s.groups = s.groups.map((g: any) => ({ ...g })).reverse(); });
      await p.write((s) => {
        const moved = s["groups.2"];
        s["groups.2"] = s["groups.4"];
        s["groups.4"] = moved;
        s["groups.1.items.0"] = { v: "v31" };
      });
      await p.write((s) => { s["groups.2.items"] = [...s["groups.2.items"]]; });
      await p.write((s) => { s["groups.1.items.0"] = { v: "v47" }; });
      const expected = ["v47,v1,v2", "v47,v1,v2", "v31,v1,v2", "v47,v1,v2", "v47,v1,v2"];
      expect(stateOf(p)).toEqual(expected);
      expect(view(p.root)).toEqual(expected);
    });
    expect(errors).toEqual([]);
  });
});

describe("#379 / #397 2 つのページの <wcs-state> が同じ素の配列を持つ", () => {
  const setup = async () => {
    const inner = L("a", "b", "c");
    const first = await page(GROUPS, { groups: [{ items: inner }, { items: inner }] });
    const second = await page(GROUPS, { groups: [{ items: inner }, { items: inner }] });
    await second.write((s) => { s["groups.0.items.0"] = { v: "N" }; });
    await first.write((s) => { s["groups.0.items.1"] = { v: "M" }; });
    await first.write((s) => { s["groups.1.items.2"] = { v: "P" }; });
    return { first, second };
  };

  it("書いた state の for だけを描き直し、エラーを出さない（書いた state の両方の外側の行に出る）", async () => {
    const errors = await errorsOf(async () => {
      const { first, second } = await setup();
      expect(view(second.root)).toEqual(["N,b,c", "N,b,c"]);
      expect(stateOf(first)).toEqual(["N,M,P", "N,M,P"]);
      // the positions first itself wrote
      expect(view(first.root).map((t) => t.split(",").slice(1).join(","))).toEqual(["M,P", "M,P"]);
    });
    expect(errors).toEqual([]);
  });

  // 3.x #379 のテストの形は、first が自分の書き込みの後に N,M,P を描く（3.x の描き直しの副作用）。4.0 では first の位置 0 は
  // a のまま: second の書き込みは first の state には知らされず、first の要素の書き込みは書いた位置の行だけを描き直す
  // （engine.ts write() の要素の分岐 — 一覧全体を読み直さない）。別の state がその場で変えた値は、その state から見て
  // 「その場の変更」なので、その要素のパスの $postUpdate で知らせる（リストのパスの $postUpdate は配列の同一性で同期するので、
  // その場で差し替えた要素を拾わない — その場の push と同じ。README の Arrays）。不具合ではなく 3.x の副作用に頼った形
  it("参考: first は自分の書き込みの後も second が書いた位置 0 を描かず（3.x は描いた）、要素のパスの $postUpdate で知らせれば描く", async () => {
    const { first } = await setup();
    expect(view(first.root)).toEqual(["a,M,P", "a,M,P"]);
    await first.write((s) => { s.$postUpdate("groups.0.items.0"); });
    expect(view(first.root)).toEqual(["N,M,P", "N,M,P"]);
  });
});

// ---------------------------------------------------------------- #393

describe("#393 共有した内側の配列を写しに替えた後の書き込みは、書いたパスの配列に着地する", () => {
  it("Issue の手順: 外側の行 1 を写しに替え、次の更新で写しの要素を差し替えると、写しに着地する", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b"));
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"]]; });
      await p.write((s) => { s["groups.1.items.0"] = { v: "M" }; });
      expect(stateOf(p)).toEqual(["a,b", "M,b"]);
      expect(view(p.root)).toEqual(["a,b", "M,b"]);
    });
    expect(errors).toEqual([]);
  });

  it("最初に描いた外側の行 0 を写しに替えても、写しと元の配列にそれぞれ着地する", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b"));
      await p.write((s) => { s["groups.0.items"] = [...s["groups.0.items"]]; });
      await p.write((s) => { s["groups.0.items.0"] = { v: "M" }; });
      await p.write((s) => { s["groups.1.items.1"] = { v: "N" }; });
      expect(stateOf(p)).toEqual(["M,b", "a,N"]);
      expect(view(p.root)).toEqual(["M,b", "a,N"]);
    });
    expect(errors).toEqual([]);
  });

  it("写しに足した後の葉の書き込みは、同じ要素に着地し、書いた外側の行に出る", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b"));
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "c" }]; });
      await p.write((s) => { s["groups.1.items.0.v"] = "M"; });
      expect(stateOf(p)).toEqual(["M,b", "M,b,c"]);
      expect(view(p.root)[1]).toBe("M,b,c");
      await p.write((s) => { s["groups.0.items.1.v"] = "N"; });
      expect(stateOf(p)).toEqual(["M,N", "M,N,c"]);
      // the position written through the first outer row
      expect(view(p.root)[0].split(",")[1]).toBe("N");
      // 3.x は、写しと元の配列が持つ同じ要素オブジェクトの葉を、もう片方の外側の行にも描く（3.x の期待 ["M,N", "M,N,c"]）。
      // 4.0 ではもう片方の外側の行は古いまま（実測 ["a,b", "M,b,c"] → ["a,N", "M,b,c"]）— 同じオブジェクトが 2 つの配列から
      // 届く形で、4.0 の既知の制限 F26（migration-v4 §5・issues-lists.test.ts #365）。ここでは期待に入れない
    });
    expect(errors).toEqual([]);
  });

  it("写しに替えた外側の行を通した葉の書き込みは、$watch(\"groups.*.items.*.v\") に書いたパスの添字で届く", async () => {
    const calls: string[] = [];
    const p = await page(GROUPS, {
      ...shared("a", "b"),
      $watch: { "groups.*.items.*.v"(value: unknown, _old: unknown, i: number, j: number) { calls.push(`${value}@${i}.${j}`); } },
    });
    await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"]]; });
    calls.length = 0;
    await p.write((s) => { s["groups.1.items.0.v"] = "W"; });
    expect(calls).toEqual(["W@1.0"]);
  });

  it("元の配列を持つ外側の行が if で隠れていても、同じ更新の差し替えは元の配列に着地する", async () => {
    const errors = await errorsOf(async () => {
      const inner = L("v0", "v1");
      const p = await page(GROUPS_IF, { groups: [{ show: false, items: inner }, { show: true, items: inner }] });
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"]]; s["groups.0.items.0"] = { v: "v4" }; });
      expect(stateOf(p)).toEqual(["v4,v1", "v0,v1"]);
      expect(view(p.root)).toEqual(["", "v0,v1"]);
      await p.write((s) => { s["groups.0.show"] = true; });
      expect(view(p.root)).toEqual(["v4,v1", "v0,v1"]);
      await p.write((s) => { s["groups.1.items.1"] = { v: "N" }; });
      expect(stateOf(p)).toEqual(["v4,v1", "v0,N"]);
      expect(view(p.root)).toEqual(["v4,v1", "v0,N"]);
    });
    expect(errors).toEqual([]);
  });

  it("3 段: 写しの行の下の、2 つの行が持つ tags の配列も、外側の行を作り直した後に描ける", async () => {
    const errors = await errorsOf(async () => {
      const tags = [{ t: "S" }, { t: "s" }];
      const inner = [{ v: "v0", tags }, { v: "v3", tags: [{ t: "t4" }, { t: "t5" }] }, { v: "v6", tags }, { v: "v8", tags: [{ t: "t9" }, { t: "t10" }] }];
      const p = await page(GROUPS_TAGS, { groups: [0, 1, 2, 3].map(() => ({ items: inner })) });
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"]]; });
      await p.write(rebuild);
      const all = Array(4).fill("v0[Ss],v3[t4t5],v6[Ss],v8[t9t10]");
      expect(view(p.root)).toEqual(all);
      expect(deepStateOf(p)).toEqual(all);
    });
    expect(errors).toEqual([]);
  });

  it("3 段: 写しに移した要素を差し替えた後、その写しを別の外側の行にも持たせても、それぞれの配列に着地して描ける", async () => {
    const errors = await errorsOf(async () => {
      const inner = [{ v: "v0", tags: [{ t: "S" }, { t: "s" }] }, { v: "v2", tags: [{ t: "t3" }] }];
      const p = await page(GROUPS_TAGS, { groups: [0, 1, 2].map(() => ({ items: inner })) });
      await p.write((s) => { s.groups = [...s.groups].reverse(); });
      await p.write((s) => {
        const moved = s["groups.0.items.1"];
        s["groups.0.items.1"] = { v: "v23", tags: [{ t: "t24" }] };
        s["groups.2.items"] = [...s["groups.2.items"], moved];
      });
      await p.write((s) => { s["groups.2.items.1"] = { v: "v29", tags: [{ t: "t30" }] }; });
      await p.write((s) => {
        s["groups.0.items.1"] = { v: "v32", tags: [{ t: "t33" }, { t: "t34" }] };
        s["groups.1.items"] = s["groups.2.items"];
      });
      const expected = ["v0[Ss],v32[t33t34]", "v0[Ss],v29[t30],v2[t3]", "v0[Ss],v29[t30],v2[t3]"];
      expect(deepStateOf(p)).toEqual(expected);
      expect(view(p.root)).toEqual(expected);
    });
    expect(errors).toEqual([]);
  });
});

describe("#393 写しを重ねた後の描画と着地", () => {
  it("手放した外側の行から付け替えた配列を、写しの外側の行と入れ替えても、それぞれの配列を描く", async () => {
    const errors = await errorsOf(async () => {
      const inner = L("v0", "v1");
      const p = await page(GROUPS_IF, { groups: [0, 1].map(() => ({ show: true, items: inner })) });
      await p.write((s) => { s.groups = s.groups.map((g: any) => ({ ...g })).reverse(); s["groups.0.items.0"] = { v: "v8" }; });
      await p.write((s) => { s["groups.0.show"] = false; s["groups.0.items"] = [...s["groups.0.items"], { v: "v12" }]; });
      await p.write((s) => {
        s["groups.1.items.1"] = { v: "v14" };
        const second = s["groups.1"];
        s["groups.1"] = s["groups.0"];
        s["groups.0"] = second;
        s["groups.0.items"] = [...s["groups.0.items"]];
      });
      expect(stateOf(p)).toEqual(["v8,v14", "v8,v1,v12"]);
      expect(view(p.root)).toEqual(["v8,v14", ""]);
    });
    expect(errors).toEqual([]);
  });

  it("写しに替えた後、隠れた別の外側の行が元の配列を引いても、写しへの書き込みは写しに着地する", async () => {
    const errors = await errorsOf(async () => {
      const inner = L("v0", "v1", "v2", "v3");
      const p = await page(GROUPS_IF, {
        groups: [{ show: true, items: inner }, { show: false, items: inner }, { show: false, items: L("v4", "v5", "v6") }],
      });
      await p.write((s) => { s["groups.0.items"] = [...s["groups.0.items"]]; });
      await p.write((s) => { s["groups.0.items.0"] = { v: "v13" }; s["groups.2.items"] = s["groups.1.items"]; });
      await p.write((s) => { s["groups.0.items.1"] = { v: "v17" }; });
      expect(stateOf(p)).toEqual(["v13,v17,v2,v3", "v0,v1,v2,v3", "v0,v1,v2,v3"]);
      expect(view(p.root)).toEqual(["v13,v17,v2,v3", "", ""]);
    });
    expect(errors).toEqual([]);
  });

  it("3 段: 隠れた外側の行を通した要素の入れ替えの後、その下の tags への差し替えが入れ替えた要素の tags に着地する", async () => {
    const errors = await errorsOf(async () => {
      const tags = [{ t: "S" }, { t: "s" }];
      const inner = [{ v: "v0", tags }, { v: "v3", tags: [{ t: "t4" }, { t: "t5" }] }, { v: "v6", tags }];
      const p = await page(GROUPS_TAGS_IF, { groups: [false, false, true].map((show) => ({ show, items: inner })) });
      await p.write((s) => { s["groups.2.items.0"] = { v: "v18", tags: [{ t: "t19" }, { t: "t20" }] }; });
      await p.write((s) => {
        const second = s["groups.0.items.1"];
        s["groups.0.items.1"] = s["groups.0.items.2"];
        s["groups.0.items.2"] = second;
      });
      await p.write((s) => { s["groups.0.items.1.tags.0"] = { t: "L31" }; });
      const expected = "v18[t19t20],v6[L31s],v3[t4t5]";
      expect(deepStateOf(p)).toEqual([expected, expected, expected]);
      expect(view(p.root)).toEqual(["", "", expected]);
    });
    expect(errors).toEqual([]);
  });

  it("隠れた外側の行を通した差し替えと写しを重ねた後、表示した外側の行が描く配列を取り違えない", async () => {
    const errors = await errorsOf(async () => {
      const inner = L("v0", "v1", "v2");
      const p = await page(GROUPS_IF, { groups: [false, false, true].map((show) => ({ show, items: inner })) });
      await p.write((s) => { s["groups.2.items"] = [...s["groups.2.items"]]; });
      await p.write((s) => { s["groups.1.items.0"] = { v: "v7" }; });
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"]]; });
      await p.write((s) => { s["groups.2.items"] = s["groups.0.items"]; });
      await p.write((s) => { s["groups.2.items.0"] = { v: "v27" }; s["groups.1.items.1"] = { v: "v29" }; });
      await p.write((s) => { s["groups.2.items"] = s["groups.0.items"]; });
      expect(stateOf(p)).toEqual(["v27,v1,v2", "v7,v29,v2", "v27,v1,v2"]);
      expect(view(p.root)).toEqual(["", "", "v27,v1,v2"]);
    });
    expect(errors).toEqual([]);
  });

  it("2 つの外側の行が持っていた配列を片方が手放した後は、もう片方の写しが描いた要素（span）を保つ", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("a", "b", "c"));
      await p.write((s) => { s["groups.1.items"] = [{ v: "x" }]; });
      const before = new Map(Array.from(p.root.querySelectorAll("div.g")[0].querySelectorAll("span")).map((n) => [n.textContent, n]));
      await p.write((s) => { s["groups.0.items"] = [...s["groups.0.items"], { v: "d" }]; });
      const after = Array.from(p.root.querySelectorAll("div.g")[0].querySelectorAll("span"));
      expect(after.filter((n) => before.get(n.textContent) === n)).toHaveLength(3);
      expect(view(p.root)).toEqual(["a,b,c,d", "x"]);
    });
    expect(errors).toEqual([]);
  });

  it("2 つの外側の行が持つ配列を行 getter で絞り込んで戻しても、どちらの外側の行も並びを描く", async () => {
    const errors = await errorsOf(async () => {
      const A = L("a", "b", "c");
      const p = await page(
        `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .shown"><span>{{ .v }}</span></template></div></template>`,
        {
          groups: [{ items: A }, { items: A }],
          hide: false,
          get "groups.*.shown"() {
            const self = this as any;
            return self.hide ? self["groups.*.items"].filter((x: any) => x.v !== "b") : self["groups.*.items"];
          },
        },
      );
      await p.write((s) => { s.hide = true; });
      expect(view(p.root)).toEqual(["a,c", "a,c"]);
      await p.write((s) => { s.hide = false; });
      expect(view(p.root)).toEqual(["a,b,c", "a,b,c"]);
    });
    expect(errors).toEqual([]);
  });
});

describe("#393 隠れた外側の行が持つ配列の写しを並べ替えた後、隠れた外側の行の配列を知らせても、写しの並びのまま描いて着地する", () => {
  const hiddenShared = () => {
    const I = L("v0", "v1", "v2");
    return { groups: [{ show: true, items: I }, { show: false, items: I }] };
  };
  async function copyRebuildReorder(p: Page, reorder: (s: any) => void): Promise<void> {
    await p.write((s) => { s["groups.0.items"] = [...s["groups.0.items"]]; });
    await p.write(rebuild);
    await p.write(reorder);
  }

  it.each<[string, (s: any) => void]>([
    ["$postUpdate", (s) => { s.$postUpdate("groups.1.items"); }],
    ["自己代入", (s) => { s["groups.1.items"] = s["groups.1.items"]; }],
    ["外側の要素の自己代入", (s) => { s["groups.1"] = s["groups.1"]; }],
  ])("逆順の写し・%s", async (_name, touch) => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS_IF, hiddenShared());
      await copyRebuildReorder(p, (s) => { s["groups.0.items"] = [...s["groups.0.items"]].reverse(); });
      await p.write(touch);
      expect(view(p.root)).toEqual(["v2,v1,v0", ""]);
      await p.write((s) => { s["groups.0.items.0.v"] = "W"; });
      expect(stateOf(p)).toEqual(["W,v1,v0", "v0,v1,W"]);
      expect(view(p.root)).toEqual(["W,v1,v0", ""]);
    });
    expect(errors).toEqual([]);
  });

  it.each<[string, (s: any) => void, string, string, string]>([
    ["絞り込んだ写し", (s) => { s["groups.0.items"] = s["groups.0.items"].filter((x: any) => x.v !== "v0"); }, "v1,v2", "W,v2", "v0,W,v2"],
    ["先頭に足した写し", (s) => { s["groups.0.items"] = [{ v: "n" }, ...s["groups.0.items"]]; }, "n,v0,v1,v2", "W,v0,v1,v2", "v0,v1,v2"],
  ])("%s・$postUpdate", async (_name, reorder, drawn, written, hidden) => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS_IF, hiddenShared());
      await copyRebuildReorder(p, reorder);
      await p.write((s) => { s.$postUpdate("groups.1.items"); });
      expect(view(p.root)).toEqual([drawn, ""]);
      await p.write((s) => { s["groups.0.items.0.v"] = "W"; });
      expect(stateOf(p)).toEqual([written, hidden]);
      expect(view(p.root)).toEqual([written, ""]);
    });
    expect(errors).toEqual([]);
  });
});

describe("#393 共有していない配列の写しは、描いた要素（span）を保つ", () => {
  it("3 段の外側の行と真ん中の行を作り直した後に内側の配列を写しに替えても、描いた要素を作り直さない", async () => {
    const errors = await errorsOf(async () => {
      const TREE = `<template data-wcs="for: groups"><section><template data-wcs="for: .subs"><div class="g"><template data-wcs="for: .items">` +
        `<span>{{ .v }}</span></template></div></template></section></template>`;
      const p = await page(TREE, {
        groups: [0, 1].map((g) => ({ subs: [0, 1].map((s) => ({ items: [{ v: `${g}${s}a` }, { v: `${g}${s}b` }] })) })),
      });
      await p.write((s) => { s.groups = s.groups.map((g: any) => ({ ...g, subs: g.subs.map((x: any) => ({ ...x })) })); });
      const first = p.root.querySelector("span");
      await p.write((s) => { s["groups.0.subs.0.items"] = [...s["groups.0.subs.0.items"], { v: "x" }]; });
      expect(p.root.querySelector("span")).toBe(first);
      expect(Array.from(p.root.querySelectorAll("div.g")).map((d) => d.textContent)).toEqual(["00a00bx", "01a01b", "10a10b", "11a11b"]);
    });
    expect(errors).toEqual([]);
  });

  it.each<[string, (s: any) => void]>([
    ["外側の行を 2 つの要素書き込みで入れ替えた後", (s) => { const first = s["groups.0"]; s["groups.0"] = s["groups.1"]; s["groups.1"] = first; }],
    ["外側の要素を同じ配列を持つ新しい要素に替えた後", (s) => { s["groups.0"] = { items: s["groups.0.items"] }; }],
  ])("%s、内側の配列を写しに替えても、描いた要素を作り直さない", async (_label, op) => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, { groups: [0, 1, 2].map((g) => ({ items: [{ v: `${g}a` }, { v: `${g}b` }] })) });
      await p.write(op);
      const first = p.root.querySelector("span");
      await p.write((s) => { s["groups.0.items"] = [...s["groups.0.items"], { v: "x" }]; });
      expect(p.root.querySelector("span")).toBe(first);
      expect(view(p.root)).toEqual(stateOf(p));
    });
    expect(errors).toEqual([]);
  });
});

describe("#393 / #394 配列を手放した外側の行が、その配列を最初に描いた外側の行のとき", () => {
  it("隠れた外側の行に知らせた更新で別の外側の行が写しに替えても、もう 1 つの外側の行の描画と書き込みは元の配列のまま", async () => {
    const errors = await errorsOf(async () => {
      const I = L("v0", "v1");
      const p = await page(GROUPS_IF, {
        groups: [{ show: false, items: I }, { show: true, items: I }, { show: true, items: I }, { show: true, items: I }],
      });
      await p.write((s) => { s["groups.2.show"] = false; });
      await p.write((s) => {
        s.$postUpdate("groups.2.items");
        s["groups.1.items"] = [...s["groups.1.items"]].reverse();
      });
      expect(view(p.root)).toEqual(["", "v1,v0", "", "v0,v1"]);
      await p.write((s) => { s["groups.3.items.1.v"] = "L"; });
      expect(stateOf(p)).toEqual(["v0,L", "L,v0", "v0,L", "v0,L"]);
      expect(view(p.root)[3]).toBe("v0,L");
      // 外側の行 1（逆順の写し）は同じ要素オブジェクトを別の配列から描く: 3.x は "L,v0"、4.0 は "v1,v0" のまま — F26（migration-v4 §5）
    });
    expect(errors).toEqual([]);
  });

  it("隠れた外側の行の配列を自己代入で知らせ、要素の入れ替え・表示・写しの逆順を 1 つの更新で重ねても、書き込みが描いた要素に着地する", async () => {
    const errors = await errorsOf(async () => {
      const I = L("v0", "v1");
      const p = await page(GROUPS_IF, { groups: [{ show: false, items: I }, { show: true, items: I }, { show: false, items: I }] });
      await p.write((s) => { s["groups.0.items"] = s["groups.0.items"]; });
      await p.write((s) => {
        const first = s["groups.1.items.0"];
        s["groups.1.items.0"] = s["groups.1.items.1"];
        s["groups.1.items.1"] = first;
        s["groups.0.show"] = true;
        s["groups.1.items"] = [...s["groups.1.items"]].reverse();
      });
      expect(view(p.root)).toEqual(["v1,v0", "v0,v1", ""]);
      await p.write((s) => { s["groups.0.items.0.v"] = "W"; });
      expect(stateOf(p)).toEqual(["W,v0", "v0,W", "W,v0"]);
      expect(view(p.root)[0]).toBe("W,v0");
      // 外側の行 1（逆順の写し）は同じ要素オブジェクトを別の配列から描く: 3.x は "v0,W"、4.0 は "v0,v1" のまま — F26（migration-v4 §5）
    });
    expect(errors).toEqual([]);
  });

  it("外側の行を逆順にして 1 つを隠し、別の外側の行が逆順の写しに替えた後で隠れた外側の行の配列を知らせても、描画と書き込みが元の配列のまま", async () => {
    const errors = await errorsOf(async () => {
      const I = L("v0", "v1");
      const p = await page(GROUPS_IF, {
        groups: [{ show: false, items: I }, { show: true, items: I }, { show: true, items: I }, { show: true, items: I }],
      });
      await p.write((s) => { s.groups = [...s.groups].reverse(); });
      await p.write((s) => { s["groups.1.show"] = false; });
      await p.write((s) => { s["groups.2.items"] = [...s["groups.2.items"]].reverse(); });
      await p.write((s) => { s.$postUpdate("groups.1.items"); });
      expect(view(p.root)).toEqual(["v0,v1", "", "v1,v0", ""]);
      await p.write((s) => { s["groups.0.items.1.v"] = "L"; });
      expect(stateOf(p)).toEqual(["v0,L", "v0,L", "L,v0", "v0,L"]);
      expect(view(p.root)[0]).toBe("v0,L");
      // 外側の行 2（逆順の写し）は同じ要素オブジェクトを別の配列から描く: 3.x は "L,v0"、4.0 は "v1,v0" のまま — F26（migration-v4 §5）
    });
    expect(errors).toEqual([]);
  });

  it("同じ更新で、外側の行を外し、残った外側の行が共有した配列を写しに替えても、描画を続ける", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, shared("v0", "v1", "v2", "v3"));
      await p.write((s) => {
        s["groups.1.items"] = s["groups.1.items"];
        s.groups = s.groups.filter((_: unknown, k: number) => k !== 1);
        s["groups.0.items"] = [...s["groups.0.items"]];
      });
      expect(view(p.root)).toEqual(["v0,v1,v2,v3"]);
      await p.write((s) => { s["groups.0.items.1"] = { v: "M" }; });
      expect(stateOf(p)).toEqual(["v0,M,v2,v3"]);
      expect(view(p.root)).toEqual(["v0,M,v2,v3"]);
    });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------- #394

describe("#394 外側の行が別の外側の行の内側の配列を取った後、書き込みはその外側の行が持つ配列に着地する", () => {
  const issue = () => {
    const A = L("v0", "v1");
    const B = L("v3", "v4");
    return { groups: [{ items: A }, { items: B }, { items: B }] };
  };
  const rebind = (s: any) => {
    s["groups.1.items"] = s["groups.0.items"];
    s.groups = [s.groups[0], s.groups[2], s.groups[1]];
  };

  it("Issue の手順: 別の行の配列を代入して並べ替え、作り直してから葉を書く", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, issue());
      await p.write(rebind);
      await p.write((s) => { rebuild(s); s["groups.1.items.0.v"] = "L45"; });
      expect(stateOf(p)).toEqual(["v0,v1", "L45,v4", "v0,v1"]);
      expect(view(p.root)).toEqual(["v0,v1", "L45,v4", "v0,v1"]);
    });
    expect(errors).toEqual([]);
  });

  it("作り直さずに葉を書いても、書いたパスの配列に着地する", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, issue());
      await p.write(rebind);
      await p.write((s) => { s["groups.1.items.0.v"] = "L45"; });
      expect(stateOf(p)).toEqual(["v0,v1", "L45,v4", "v0,v1"]);
      expect(view(p.root)).toEqual(["v0,v1", "L45,v4", "v0,v1"]);
    });
    expect(errors).toEqual([]);
  });

  it("外側の行を 2 つの要素書き込みで入れ替え、同じ更新で入れ替えた行の内側の要素を差し替える", async () => {
    const errors = await errorsOf(async () => {
      const inner = L("v0", "v1", "v2", "v3");
      const p = await page(GROUPS, { groups: [0, 1, 2].map(() => ({ items: inner })) });
      await p.write((s) => { s.groups = [...s.groups, { items: s["groups.1.items"] }]; });
      await p.write((s) => { s["groups.2.items"] = [...s["groups.2.items"]]; rebuild(s); });
      await p.write((s) => {
        const second = s["groups.1"];
        s["groups.1"] = s["groups.2"];
        s["groups.2"] = second;
        s["groups.2.items.1"] = { v: "v18" };
      });
      const shared18 = "v0,v18,v2,v3";
      expect(stateOf(p)).toEqual([shared18, "v0,v1,v2,v3", shared18, shared18]);
      expect(view(p.root)).toEqual([shared18, "v0,v1,v2,v3", shared18, shared18]);
    });
    expect(errors).toEqual([]);
  });

  it("手放した後に作り直して並べ替え（作り直しと 2 回の逆順を 1 つの更新で）、それぞれの配列を描き、要素を同じ位置へ書き戻しても状態が変わらない", async () => {
    const errors = await errorsOf(async () => {
      const A = L("v0", "v1");
      const B = L("v2", "v3", "v4", "v5");
      const p = await page(GROUPS, { groups: [{ items: A }, { items: B }, { items: A }, { items: A }] });
      await p.write((s) => { s["groups.0.items"] = s["groups.1.items"]; });
      await p.write((s) => { s.groups = [...s.groups].reverse(); });
      await p.write((s) => { s.groups = s.groups.map((g: any) => ({ ...g })).reverse(); s.groups = [...s.groups].reverse(); });
      const before = ["v0,v1", "v0,v1", "v2,v3,v4,v5", "v2,v3,v4,v5"];
      expect(stateOf(p)).toEqual(before);
      expect(view(p.root)).toEqual(before);
      await p.write((s) => { const element = s["groups.0.items.1"]; s["groups.0.items.1"] = element; });
      expect(stateOf(p)).toEqual(before);
      expect(view(p.root)).toEqual(before);
    });
    expect(errors).toEqual([]);
  });

  it("内側の配列を別の外側の行へ移すと、移した先で要素を描く（3.3.0 は空の文字を描いた）", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, { groups: [{ items: L("a", "b") }, { items: L("p", "q") }] });
      await p.write((s) => { const moved = s["groups.0.items"]; s["groups.0.items"] = []; s["groups.1.items"] = moved; });
      expect(view(p.root)).toEqual(["", "a,b"]);
    });
    expect(errors).toEqual([]);
  });
});

describe("#394 別の外側の行が引き継いだ配列を、さらに別の配列に替える", () => {
  it("手放した配列を別の外側の行が引き、別の配列に替えてから書くと、その配列に着地する", async () => {
    const errors = await errorsOf(async () => {
      const A = L("a", "b");
      const p = await page(GROUPS, { groups: [{ items: A }, { items: L("p", "q") }], pool: A });
      await p.write((s) => { s["groups.0.items"] = L("d1", "d2"); });
      await p.write((s) => { s["groups.1.items"] = s.pool; });
      await p.write((s) => { s["groups.1.items"] = L("x", "y"); });
      await p.write((s) => { s["groups.1.items.0"] = { v: "M" }; });
      expect(stateOf(p)).toEqual(["d1,d2", "M,y"]);
      expect(view(p.root)).toEqual(["d1,d2", "M,y"]);
    });
    expect(errors).toEqual([]);
  });

  it("内側の配列を別の外側の行へ移して替え、元の外側の行に足しても、それぞれの配列に着地する", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, { groups: [{ items: L("a", "b") }, { items: L("p", "q") }] });
      await p.write((s) => { const moved = s["groups.0.items"]; s["groups.0.items"] = []; s["groups.1.items"] = moved; });
      await p.write((s) => { s["groups.1.items"] = L("x", "y"); });
      await p.write((s) => { s["groups.1.items.0"] = { v: "M" }; });
      await p.write((s) => { s["groups.0.items"] = [...s["groups.0.items"], { v: "k" }]; });
      expect(stateOf(p)).toEqual(["k", "M,y"]);
      expect(view(p.root)).toEqual(["k", "M,y"]);
    });
    expect(errors).toEqual([]);
  });

  it("内側の配列を別の外側の行へ移して足した後も、移した先の外側の行に着地する", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(GROUPS, { groups: [{ items: L("a", "b") }, { items: L("p", "q") }] });
      await p.write((s) => { const moved = s["groups.0.items"]; s["groups.0.items"] = []; s["groups.1.items"] = moved; });
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "c" }]; });
      await p.write((s) => { s["groups.1.items.0"] = { v: "M" }; });
      await p.write((s) => { s["groups.1.items.2.v"] = "C!"; });
      expect(stateOf(p)).toEqual(["", "M,b,C!"]);
      expect(view(p.root)).toEqual(["", "M,b,C!"]);
    });
    expect(errors).toEqual([]);
  });

  it("外側の行 2 つを 2 つの要素書き込みで入れ替え、同じ更新で片方の内側の配列に書くと、それぞれの配列を描く", async () => {
    const errors = await errorsOf(async () => {
      const A = L("a0", "a1");
      const B = L("b0", "b1");
      const p = await page(GROUPS, { groups: [{ items: A }, { items: A }, { items: B }] });
      await p.write((s) => {
        const a = s["groups.1"];
        const b = s["groups.2"];
        s["groups.1"] = b;
        s["groups.2"] = a;
        s["groups.1.items.0"] = { v: "N" };
      });
      expect(stateOf(p)).toEqual(["a0,a1", "N,b1", "a0,a1"]);
      expect(view(p.root)).toEqual(["a0,a1", "N,b1", "a0,a1"]);
    });
    expect(errors).toEqual([]);
  });

});

describe("#394 同じ外側の行の 2 つのキーが同じ配列を持つ（手放すのは、どのキーも持たなくなったとき）", () => {
  it("片方のキーだけを替えた配列を別の外側の行が引いて替えても、もう片方のキーの書き込みはその配列に着地する", async () => {
    const errors = await errorsOf(async () => {
      const A = L("a", "b");
      const p = await page(DUAL, { groups: [{ items: A, alt: A }, { items: L("p", "q"), alt: L("r") }] });
      await p.write((s) => { s["groups.0.alt"] = L("z"); });
      await p.write((s) => { s["groups.1.items"] = s["groups.0.items"]; });
      await p.write((s) => { s["groups.1.items"] = L("x", "y"); });
      await p.write((s) => { s["groups.0.items.1"] = { v: "R" }; });
      expect(stateDual(p)).toEqual(["a,R|z", "x,y|r"]);
      expect(viewDual(p.root)).toEqual(["a,R|z", "x,y|r"]);
    });
    expect(errors).toEqual([]);
  });

  it("片方のキーを絞り込んだ写しに替えても、もう片方のキーの葉の書き込みが描かれる", async () => {
    const errors = await errorsOf(async () => {
      const A = L("a", "b", "c");
      const p = await page(DUAL, { groups: [{ items: A, alt: A }, { items: L("p"), alt: L("p") }] });
      await p.write((s) => { s["groups.0.alt"] = s["groups.0.items"].filter((x: any) => x.v !== "b"); });
      await p.write((s) => { s["groups.1.items"] = s["groups.0.items"]; });
      await p.write((s) => { s["groups.1.items"] = L("p2"); });
      await p.write((s) => { s["groups.0.items.1.v"] = "B!"; });
      expect(stateDual(p)).toEqual(["a,B!,c|a,c", "p2|p"]);
      expect(viewDual(p.root)).toEqual(["a,B!,c|a,c", "p2|p"]);
    });
    expect(errors).toEqual([]);
  });

  it("作り直した外側の行で片方のキーを写しに替えた後、別の外側の行が引いて替えても、差し替えが着地する", async () => {
    const errors = await errorsOf(async () => {
      const A = L("a", "b");
      const p = await page(DUAL, { groups: [{ items: A, alt: A }, { items: L("p"), alt: L("q") }] });
      await p.write((s) => { s.groups = s.groups.slice(1); });
      await p.write((s) => { const B = L("a", "b"); s.groups = [{ items: B, alt: B }, ...s.groups]; });
      await p.write((s) => { s["groups.0.items.0"] = { v: "M" }; });
      await p.write((s) => { s["groups.0.alt"] = [...s["groups.0.alt"]]; });
      await p.write((s) => { s["groups.1.items"] = s["groups.0.items"]; });
      await p.write((s) => { s["groups.1.items"] = L("n"); });
      await p.write((s) => { s["groups.0.items.1"] = { v: "R" }; });
      expect(stateDual(p)).toEqual(["M,R|M,b", "n|q"]);
      expect(viewDual(p.root)).toEqual(["M,R|M,b", "n|q"]);
    });
    expect(errors).toEqual([]);
  });
});

describe("#394 同じ外側の行が同じ配列を 2 つのキーに持ち、別の外側の行も持つ", () => {
  it("最初の外側の行を外し、最後の外側の行に写しを持たせて差し替えると、その配列を持つどの一覧にも出る", async () => {
    const errors = await errorsOf(async () => {
      const A = L("v0", "v1", "v2");
      const p = await page(DUAL, { groups: [0, 1, 2].map(() => ({ items: A, alt: A })) });
      await p.write((s) => { s.groups = s.groups.filter((_: unknown, k: number) => k !== 0); });
      await p.write((s) => { s["groups.1.items"] = [...s["groups.1.items"], { v: "P" }]; });
      await p.write((s) => { s["groups.0.items.0"] = { v: "M" }; });
      expect(stateDual(p)).toEqual(["M,v1,v2|M,v1,v2", "v0,v1,v2,P|M,v1,v2"]);
      expect(viewDual(p.root)).toEqual(["M,v1,v2|M,v1,v2", "v0,v1,v2,P|M,v1,v2"]);
    });
    expect(errors).toEqual([]);
  });

  it("片方のキーだけに配列を持つ外側の行がある一覧を逆順にして作り直しても、差し替えがその配列を持つどの一覧にも出る", async () => {
    const errors = await errorsOf(async () => {
      const A = L("a0", "a1");
      const B = L("b0", "b1");
      const p = await page(DUAL, { groups: [{ items: A, alt: A }, { items: A, alt: A }, { items: B, alt: A }] });
      await p.write((s) => { s.groups = [...s.groups].reverse(); });
      await p.write(rebuild);
      expect(viewDual(p.root)).toEqual(["b0,b1|a0,a1", "a0,a1|a0,a1", "a0,a1|a0,a1"]);
      await p.write((s) => { s["groups.2.items.0"] = { v: "M" }; });
      expect(stateDual(p)).toEqual(["b0,b1|M,a1", "M,a1|M,a1", "M,a1|M,a1"]);
      expect(viewDual(p.root)).toEqual(["b0,b1|M,a1", "M,a1|M,a1", "M,a1|M,a1"]);
    });
    expect(errors).toEqual([]);
  });

  it("片方のキーを逆順の写しに替えて作り直した後、もう 1 つの外側の行を通した葉の書き込みは、その配列を描く別のキーの一覧にも出る", async () => {
    const errors = await errorsOf(async () => {
      const A = L("v0", "v1", "v2");
      const p = await page(DUAL, { groups: [0, 1].map(() => ({ items: A, alt: A })) });
      await p.write((s) => { s["groups.0.alt"] = [...s["groups.0.alt"]].reverse(); });
      await p.write(rebuild);
      expect(viewDual(p.root)).toEqual(["v0,v1,v2|v2,v1,v0", "v0,v1,v2|v0,v1,v2"]);
      await p.write((s) => { s["groups.1.alt.1.v"] = "L"; });
      expect(stateDual(p)).toEqual(["v0,L,v2|v2,L,v0", "v0,L,v2|v0,L,v2"]);
      // the lists over A: both outer rows' items and the second outer row's alt
      const drawn = viewDual(p.root).map((t) => t.split("|"));
      expect([drawn[0][0], drawn[1][0], drawn[1][1]]).toEqual(["v0,L,v2", "v0,L,v2", "v0,L,v2"]);
      // 外側の行 0 の alt（逆順の写し）は同じ要素オブジェクトを別の配列から描く: 3.x は "v2,L,v0"、4.0 は "v2,v1,v0" のまま — F26
    });
    expect(errors).toEqual([]);
  });

  it("2 つのキーに同じ配列を持つ外側の行を足し、別の外側の行がその配列を片方のキーで引き継いで写しに替えた後も、差し替えが着地して描かれる（3.4 は空の文字を描く）", async () => {
    const errors = await errorsOf(async () => {
      const A = L("v0");
      const B = L("v1", "v2");
      const p = await page(DUAL, { groups: [{ items: A, alt: B }, { items: A, alt: B }] });
      await p.write((s) => { s.groups = [...s.groups, { items: s["groups.0.alt"], alt: s["groups.0.alt"] }]; });
      expect(viewDual(p.root)).toEqual(["v0|v1,v2", "v0|v1,v2", "v1,v2|v1,v2"]);
      await p.write((s) => { s["groups.0.items"] = s["groups.2.items"]; rebuild(s); });
      await p.write((s) => { s["groups.0.alt"] = [...s["groups.0.alt"]]; });
      await p.write((s) => { s["groups.1.alt.1"] = { v: "R" }; });
      expect(stateDual(p)).toEqual(["v1,R|v1,v2", "v0|v1,R", "v1,R|v1,R"]);
      expect(viewDual(p.root)).toEqual(["v1,R|v1,v2", "v0|v1,R", "v1,R|v1,R"]);
    });
    expect(errors).toEqual([]);
  });

  it.each<[string, (s: any) => void]>([
    ["items を替えてから alt に書く", (s) => { const moved = s["groups.0.items"]; s["groups.0.items"] = L("B"); s["groups.0.alt"] = moved; }],
    ["alt に書いてから items を替える", (s) => { const moved = s["groups.0.items"]; s["groups.0.alt"] = moved; s["groups.0.items"] = L("B"); }],
  ])("1 つの更新で同じ外側の行の items から alt へ配列を移しても（%s）、差し替えが着地し、その配列を持つ一覧に出る（3.4 は B,b を描く）", async (_name, move) => {
    const errors = await errorsOf(async () => {
      const A = L("a", "b");
      const p = await page(DUAL, { groups: [{ items: A, alt: L("x") }, { items: A, alt: L("y") }] });
      await p.write(move);
      expect(viewDual(p.root)).toEqual(["B|a,b", "a,b|y"]);
      await p.write((s) => { s["groups.0.alt.0"] = { v: "M" }; });
      expect(stateDual(p)).toEqual(["B|M,b", "M,b|y"]);
      expect(viewDual(p.root)).toEqual(["B|M,b", "M,b|y"]);
    });
    expect(errors).toEqual([]);
  });

  it("同じ更新で葉に書き、もう片方のキーを写しに替えても、同じ配列を描く別のキーの一覧に葉の書き込みが出る", async () => {
    const errors = await errorsOf(async () => {
      const A = L("v1", "v2", "v3");
      const p = await page(DUAL, { groups: [{ items: A, alt: A }, { items: A, alt: A }] });
      await p.write((s) => {
        s["groups.0.items.1.v"] = "L";
        s["groups.0.alt"] = [...s["groups.0.alt"]];
      });
      expect(stateDual(p)).toEqual(["v1,L,v3|v1,L,v3", "v1,L,v3|v1,L,v3"]);
      expect(viewDual(p.root)).toEqual(["v1,L,v3|v1,L,v3", "v1,L,v3|v1,L,v3"]);
    });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------- #396

describe("#396 同じ配列を別の外側の行が別のキーに持つ（3.4 は別の要素に書く — 正しい期待）", () => {
  it("groups.1.alt を逆順の写しにし、groups.0.items をその写しにすると、groups.0.items.0.v への書き込みは写しの先頭の要素に着地する", async () => {
    const errors = await errorsOf(async () => {
      const A = L("v0", "v1");
      const p = await page(DUAL, { groups: [0, 1, 2].map(() => ({ items: A, alt: A })) });
      await p.write((s) => { s["groups.1.alt"] = [...s["groups.1.alt"]].reverse(); });
      await p.write((s) => { s["groups.0.items"] = s["groups.1.alt"]; });
      expect(viewDual(p.root)).toEqual(["v1,v0|v0,v1", "v0,v1|v1,v0", "v0,v1|v0,v1"]);
      await p.write((s) => { s["groups.0.items.0.v"] = "L"; });
      // the first element of groups.0.items is v1 (3.4 wrote into v0: ["v1,L|L,v1", "L,v1|v1,L", "L,v1|L,v1"])
      expect(stateDual(p)).toEqual(["L,v0|v0,L", "v0,L|L,v0", "v0,L|v0,L"]);
      // the lists over the written array (the reversed copy): groups.0.items and groups.1.alt
      const drawn = viewDual(p.root).map((t) => t.split("|"));
      expect([drawn[0][0], drawn[1][1]]).toEqual(["L,v0", "L,v0"]);
      // A を描く一覧（groups.0.alt・groups.1.items・groups.2 の両方）は同じ要素オブジェクトを別の配列から描く: 期待は "v0,L"、
      // 4.0 は "v0,v1" のまま — F26（migration-v4 §5）。3.4 は状態そのものを誤る（#396）
    });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------- #397

describe("#397 内側の配列を <wcs-state> をまたいで共有する（3.4 は書き込みを写しに着地させる・投げる — 正しい期待）", () => {
  it("2 つのページが同じ A を 2 つの外側の行に持ち、片方で外側の行を作り直し、もう片方で写しに替えて差し替えると、A に着地する", async () => {
    const errors = await errorsOf(async () => {
      const A = L("a", "b", "c");
      const first = await page(GROUPS, { groups: [{ items: A }, { items: A }] });
      const second = await page(GROUPS, { groups: [{ items: A }, { items: A }] });
      await first.write(rebuild);
      await second.write((s) => { s["groups.0.items"] = [...s["groups.0.items"]]; });
      await second.write((s) => { s["groups.1.items.0"] = { v: "M" }; });
      // 3.4: second ["M,b,c", "a,b,c"] (the copy took the write), first ["a,b,c", "a,b,c"]
      expect(stateOf(second)).toEqual(["a,b,c", "M,b,c"]);
      expect(view(second.root)).toEqual(["a,b,c", "M,b,c"]);
      expect(stateOf(first)).toEqual(["M,b,c", "M,b,c"]);
    });
    expect(errors).toEqual([]);
  });

  it("ルートと、ルートに接ぎ木したボリュームが同じ内側の配列を持ち、ルートが写しに替えた後のボリュームの差し替えが投げずに A に着地する", async () => {
    const A = L("a0", "a1");
    const h = document.createElement(`regression-3x-shared-inner-vol-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state mount="vol"></wcs-state><wcs-state></wcs-state>` + GROUPS +
      `<section><template data-wcs="for: vol.groups"><p><template data-wcs="for: .items"><i>{{ .v }}</i></template></p></template></section>`;
    const volume = root.querySelector("wcs-state[mount]") as any;
    const rootEl = root.querySelector("wcs-state:not([mount])") as any;
    rootEl.setInitialState({ groups: [{ items: A }, { items: A }] });
    volume.setInitialState({ groups: [{ items: A }] });
    document.body.appendChild(h);
    const errors = await errorsOf(async () => {
      await rootEl.connectedCallbackPromise;
      await volume.connectedCallbackPromise;
      await getBindingsReady(root);
      await flush();
      await flush();
      const p = handles(root, rootEl, h);
      expect(view(root)).toEqual(["a0,a1", "a0,a1"]);
      expect(texts(root, "section i")).toEqual(["a0", "a1"]);
      await p.write((s) => { s["groups.0.items"] = [...s["groups.0.items"]]; });
      // 3.4: throws "Reflect.set called on non-object" and the write is lost
      expect(() => rootEl.createState("writable", (s: any) => { s["vol.groups.0.items.0"] = { v: "M" }; })).not.toThrow();
      await flush();
      await flush();
      expect(p.snap((s) => s["vol.groups.0.items"].map((x: any) => x.v).join(","))).toBe("M,a1");
      expect(stateOf(p)).toEqual(["a0,a1", "M,a1"]);
      expect(texts(root, "section i")).toEqual(["M", "a1"]);
      expect(view(root)).toEqual(["a0,a1", "M,a1"]);
    });
    expect(errors).toEqual([]);
    h.remove();
  });

  it("2 つのページが同じ外側の配列を持ち、片方で外側の行を作り直しても、もう片方の差し替えがそのページに描かれる（3.4 は描かない）", async () => {
    const errors = await errorsOf(async () => {
      const G = [{ items: L("a", "b", "c") }, { items: L("x", "y") }];
      const first = await page(GROUPS, { groups: G });
      const second = await page(GROUPS, { groups: G });
      await first.write(rebuild);
      await second.write((s) => { s["groups.0.items.1"] = { v: "M" }; });
      expect(stateOf(second)).toEqual(["a,M,c", "x,y"]);
      expect(view(second.root)).toEqual(["a,M,c", "x,y"]);
      first.host.remove();
      second.host.remove();
    });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------- #398

describe("#398 3.4 の README の制限（状態は正しいが描き損ねる形 — 正しい期待）", () => {
  it("入れ子の別のパス（.sub.alt）がまだ持つ配列を別の外側の行に渡して作り直した後の葉の書き込みが、その配列を描く別のキーの一覧にも出る", async () => {
    const errors = await errorsOf(async () => {
      const TWO_PATHS = `<template data-wcs="for: groups"><div class="g"><template data-wcs="for: .items"><span>{{ .v }}</span></template>` +
        `<template data-wcs="for: .sub.alt"><b>{{ .v }}</b></template></div></template>`;
      const A = L("a0", "a1");
      const C = L("c0");
      const p = await page(TWO_PATHS, { groups: [{ items: A, sub: { alt: A } }, { items: C, sub: { alt: C } }] });
      await p.write((s) => { s["groups.0.items"] = L("b0", "b1"); });
      await p.write((s) => { s["groups.1.items"] = s["groups.0.sub.alt"]; });
      expect(viewDual(p.root)).toEqual(["b0,b1|a0,a1", "a0,a1|c0"]);
      await p.write(rebuild);
      expect(viewDual(p.root)).toEqual(["b0,b1|a0,a1", "a0,a1|c0"]);
      await p.write((s) => { s["groups.0.sub.alt.0.v"] = "X"; });
      expect(p.snap((s) => s.groups.map((g: any) => `${g.items.map((x: any) => x.v).join(",")}|${g.sub.alt.map((x: any) => x.v).join(",")}`)))
        .toEqual(["b0,b1|X,a1", "X,a1|c0"]);
      // 3.4: the second outer row's for: .items keeps a0,a1
      expect(viewDual(p.root)).toEqual(["b0,b1|X,a1", "X,a1|c0"]);
    });
    expect(errors).toEqual([]);
  });

  it("写しの写しを別の外側の行にも持たせた後の葉の書き込みが、その写しを持つ外側の行に出る", async () => {
    const errors = await errorsOf(async () => {
      const I = L("v0", "v1", "v2");
      const p = await page(GROUPS_IF, { groups: [0, 1, 2, 3].map(() => ({ show: true, items: I })) });
      await p.write((s) => {
        s["groups.3.items"] = [...s["groups.3.items"]];
        s.groups = [...s.groups, { show: true, items: s["groups.3.items"] }];
      });
      await p.write((s) => { s["groups.4.items"] = [...s["groups.4.items"]]; });
      await p.write((s) => {
        s["groups.1.items"] = s["groups.4.items"];
        s["groups.4.items.0.v"] = "L";
      });
      expect(stateOf(p)).toEqual(["L,v1,v2", "L,v1,v2", "L,v1,v2", "L,v1,v2", "L,v1,v2"]);
      // groups.1 and groups.4 hold the written array. groups.0 / .2 (I) and .3 (the first copy) reach the same
      // object through other arrays: F26 (migration-v4 §5), not asserted here
      const drawn = view(p.root);
      expect([drawn[1], drawn[4]]).toEqual(["L,v1,v2", "L,v1,v2"]);
    });
    expect(errors).toEqual([]);
  });

  it("2 つの要素が同じ tags を持つ配列で、片方の tags の要素の差し替えと別の外側の行の共有を 1 つの更新で重ねても、もう片方の要素の tags にも出る", async () => {
    const errors = await errorsOf(async () => {
      const T = [{ t: "S" }, { t: "s" }];
      const I = [{ v: "v0", tags: T }, { v: "v2", tags: [{ t: "t3" }] }, { v: "v5", tags: T }];
      const J = [{ v: "w0", tags: [{ t: "u1" }] }];
      const p = await page(GROUPS_TAGS, { groups: [{ items: I }, { items: I }, { items: I }, { items: J }] });
      await p.write((s) => {
        s["groups.2.items"] = s["groups.3.items"];
        s["groups.1.items.0.tags.0"] = { t: "L" };
      });
      const expected = ["v0[Ls],v2[t3],v5[Ls]", "v0[Ls],v2[t3],v5[Ls]", "w0[u1]", "w0[u1]"];
      expect(deepStateOf(p)).toEqual(expected);
      // 3.4: v5[Ss] in the first two outer rows
      expect(view(p.root)).toEqual(expected);
    });
    expect(errors).toEqual([]);
  });

  it("外側の行 0 の写しと、外側の行 2 の要素を外側の行 1 の写しへ移すのを 1 つの更新で重ねた後、外側の行 2 の tags の差し替えが全部の外側の行に出る", async () => {
    const errors = await errorsOf(async () => {
      const I = [{ v: "v0", tags: [{ t: "S" }, { t: "s" }] }, { v: "v3", tags: [{ t: "t4" }] }];
      const p = await page(GROUPS_TAGS, { groups: [{ items: I }, { items: I }, { items: I }] });
      await p.write((s) => {
        s["groups.0.items"] = [...s["groups.0.items"]];
        const moved = s["groups.2.items.0"];
        s["groups.2.items.0"] = { v: "v15", tags: [{ t: "t16" }] };
        s["groups.1.items"] = [...s["groups.1.items"], moved];
      });
      expect(view(p.root)).toEqual(["v0[Ss],v3[t4]", "v15[t16],v3[t4],v0[Ss]", "v15[t16],v3[t4]"]);
      await p.write((s) => { s["groups.2.items.1.tags.0"] = { t: "L21" }; });
      const expected = ["v0[Ss],v3[L21]", "v15[t16],v3[L21],v0[Ss]", "v15[t16],v3[L21]"];
      expect(deepStateOf(p)).toEqual(expected);
      // 3.4: the third outer row keeps v3[t4]
      expect(view(p.root)).toEqual(expected);
    });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------- #365

describe("#365 同じオブジェクトを 2 つの行に置いたときの回避策（書いた後の $postUpdate(\"items\")）", () => {
  // 書いた行でない方の行が古いまま残る形そのものは、4.0 の既知の制限 F26（issues-lists.test.ts の #365 が it.fails で持つ）
  const state = () => {
    const o = { name: "a" };
    return {
      items: [o, o, { name: "c" }],
      get all() { return (this as any).$getAll("items.*.name", []).join("/"); },
      rename(this: any) { this["items.0.name"] = "z"; this.$postUpdate("items"); },
    };
  };

  it("for で描く一覧・$getAll・添字の読みが揃う", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(`<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul><p>{{ all }}</p>`, state());
      await p.write((s) => { s.rename(); });
      expect(texts(p.root, "li")).toEqual(["z", "z", "c"]);
      expect(p.snap((s) => s["items.1.name"])).toBe("z");
      expect(texts(p.root, "p")).toEqual(["z/z/c"]);
    });
    expect(errors).toEqual([]);
  });

  it("for で描いていない一覧でも、添字の束縛と読みが揃う", async () => {
    const errors = await errorsOf(async () => {
      const p = await page(`<b>{{ items.0.name }}</b><i>{{ items.1.name }}</i><p>{{ all }}</p>`, state());
      await p.write((s) => { s.rename(); });
      expect(texts(p.root, "b")).toEqual(["z"]);
      expect(texts(p.root, "i")).toEqual(["z"]);
      expect(p.snap((s) => s["items.1.name"])).toBe("z");
      expect(texts(p.root, "p")).toEqual(["z/z/c"]);
    });
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------- #379 / #393 / #394 cost (behaviour only)

describe("#379 / #393 / #394 費用の番人の形（時間・読みの回数は見ず、描いた値だけを見る）", () => {
  it("外側の行を作り直した後、共有しない 60 行の位置 0 を 1 つのバッチで差し替えると、全部の行に出る", async () => {
    const G = 60;
    const p = await page(GROUPS, { groups: Array.from({ length: G }, (_, g) => ({ items: L(`a${g}`, `b${g}`, `c${g}`) })) });
    await p.write(rebuild);
    await p.write((s) => { for (let g = 0; g < G; g++) s[`groups.${g}.items.0`] = { v: `N${g}` }; });
    const drawn = view(p.root);
    expect(drawn).toEqual(Array.from({ length: G }, (_, g) => `N${g},b${g},c${g}`));
    p.host.remove();
  });

  it("2 行ずつ同じ配列を持つ 60 行で各組の位置 0 を差し替えると、組の両方の行に出る", async () => {
    const G = 60;
    const p = await page(GROUPS, {
      groups: Array.from({ length: G / 2 }, (_, k) => {
        const inner = L(`a${k}`, `b${k}`, `c${k}`);
        return [{ items: inner }, { items: inner }];
      }).flat(),
    });
    await p.write((s) => { for (let k = 0; k < G / 2; k++) s[`groups.${2 * k}.items.0`] = { v: `N${k}` }; });
    expect(view(p.root)).toEqual(Array.from({ length: G }, (_, g) => `N${g >> 1},b${g >> 1},c${g >> 1}`));
    p.host.remove();
  });

  it("10 行が同じ配列を持つとき、同じバッチの 20 回の差し替えが 10 行すべてに出る", async () => {
    const G = 10, N = 20;
    const inner = Array.from({ length: N }, (_, i) => ({ v: `${i}` }));
    const p = await page(GROUPS, { groups: Array.from({ length: G }, () => ({ items: inner })) });
    await p.write((s) => { for (let i = 0; i < N; i++) s[`groups.0.items.${i}`] = { v: `x${i}` }; });
    const expected = Array.from({ length: N }, (_, i) => `x${i}`).join(",");
    expect(view(p.root)).toEqual(Array(G).fill(expected));
    p.host.remove();
  });

  it("同じ配列を持つ 200 行を 1 行に減らした後、50 回の差し替えが残った行に出る", async () => {
    const items = L("a", "b", "c");
    const p = await page(GROUPS, { groups: Array.from({ length: 200 }, () => ({ items })) });
    await p.write((s) => { s.groups = [s.groups[0]]; });
    for (let i = 0; i < 50; i++) {
      p.el.createState("writable", (s: any) => { s[`groups.0.items.${i % 3}`] = { v: `w${i}` }; });
    }
    await flush();
    await flush();
    expect(view(p.root)).toEqual(["w48,w49,w47"]);
    p.host.remove();
  });

  it.each<[string, boolean]>([
    ["真ん中の行ごとに別の配列", false],
    ["どの真ん中の行も同じ配列", true],
  ])("3 段（10 × 10 の真ん中の行・3 つの要素）の外側の行と真ん中の行を 120 回作り直しても、描いた値と書き込みが正しい（%s）", async (_name, sameArray) => {
    const TREE = `<template data-wcs="for: groups"><section><template data-wcs="for: .subs"><div class="g"><template data-wcs="for: .items">` +
      `<span>{{ .v }}</span></template></div></template></section></template>`;
    const one = L("x", "y", "z");
    const p = await page(TREE, {
      groups: Array.from({ length: 10 }, (_, g) => ({
        subs: Array.from({ length: 10 }, (_, k) => ({ items: sameArray ? one : L(`${g}${k}a`, `${g}${k}b`, `${g}${k}c`) })),
      })),
    });
    for (let n = 0; n < 120; n++) {
      p.el.createState("writable", (s: any) => {
        s.groups = s.groups.map((g: any) => ({ ...g, subs: g.subs.map((x: any) => ({ ...x })) }));
      });
      await flush();
    }
    await flush();
    const expected = (g: number, k: number) => sameArray ? "x,y,z" : `${g}${k}a,${g}${k}b,${g}${k}c`;
    const drawn = view(p.root);
    expect(drawn).toHaveLength(100);
    expect(drawn).toEqual(Array.from({ length: 100 }, (_, i) => expected(Math.floor(i / 10), i % 10)));
    await p.write((s) => { s["groups.9.subs.9.items.1"] = { v: "W" }; });
    const after = view(p.root);
    expect(after[99]).toBe(sameArray ? "x,W,z" : "99a,W,99c");
    expect(after.filter((t) => t.includes("W"))).toHaveLength(sameArray ? 100 : 1);
    p.host.remove();
  });
});

// ---------------------------------------------------------------- #256 / #393 / #394 (divergentLedgerReplacement)

describe("#393 / #394 行オブジェクトだけを作り直す置換の後も、行 getter と葉の書き込みが生きている行に届く（divergentLedgerReplacement の観察できる部分）", () => {
  const fixture = () => {
    const counter = { evals: 0 };
    const initial: Record<string, any> = {
      nodes: [
        { value: 1, children: [{ value: 10 }, { value: 20 }] },
        { value: 2, children: [] },
      ],
      get "nodes.*.total"() {
        counter.evals++;
        const self = this as any;
        return self["nodes.*.value"] + self.$getAll("nodes.*.children.*.value").reduce((a: number, b: number) => a + b, 0);
      },
    };
    return { initial, counter };
  };
  const NESTED_FOR =
    `<ul><template data-wcs="for: nodes"><li class="row">` +
    `<b class="total" data-wcs="textContent: .total"></b>` +
    `<template data-wcs="for: nodes.*.children"><i class="kid">{{ .value }}</i></template>` +
    `</li></template></ul>`;

  it.each<[string, (s: any) => void]>([
    ["map-spread", (s) => { s.nodes = s.nodes.map((n: any) => ({ ...n })); }],
    ["[...nodes]", (s) => { s.nodes = [...s.nodes]; }],
  ])("%s の置換では表示が変わらず、その後の $resolve の葉の書き込みが行 getter と子の行に出る", async (_label, replace) => {
    const errors = await errorsOf(async () => {
      const { initial, counter } = fixture();
      const p = await page(NESTED_FOR, initial);
      expect(texts(p.root, ".total")).toEqual(["31", "2"]);
      const before = counter.evals;
      await p.write(replace);
      // at most the two live rows are evaluated again (3.3.0 also marked a retired row)
      expect(counter.evals - before).toBeLessThanOrEqual(2);
      expect(texts(p.root, ".total")).toEqual(["31", "2"]);
      await p.write((s) => { s.$resolve("nodes.*.children.*.value", [0, 0], 99); });
      expect(texts(p.root, ".total")).toEqual(["120", "2"]);
      expect(texts(p.root, ".kid")).toEqual(["99", "20"]);
    });
    expect(errors).toEqual([]);
  });
});
