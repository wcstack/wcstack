/**
 * issues2-components.test.ts — 現行 @wcstack/state 3.3 に登録された Issue #384 / #385 / #386 / #387 / #391
 * （行の部品の完全マウント `state: .`・別の root への要素の移動・マウントのテストの時間）を state-next で流す。
 * 各 Issue の「期待」を確かめる。移した要素の委譲されたイベント（F38、まだ直していない）は it.fails で症状を残す。
 * 計測（#385・#391）は bench/issues2.perf.test.ts（単体テストには正しさだけを置く）。
 * 全部入りの auto と同じく、すべての後付け（診断を含む）を入れて流す。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures } from "../src/index";
import { ALL_FEATURES } from "../src/features/all";

const flush = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;

beforeAll(() => {
  installFeatures(ALL_FEATURES);
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`issues2-c-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise.catch(() => {});
  await getBindingsReady(root);
  await flush();
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
    await flush();
  };
  const read = (path: string) => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  return { host: h, root, el, write, read };
}

/** A component whose `<wcs-state bind-component="state">` sits in its shadow root. */
function component(markup: string, state: () => Record<string, any>): string {
  const tag = `issues2-c-cmp-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    state = state();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${markup}`;
    }
  });
  return tag;
}

const messagesOf = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((x) => x.map((a) => String((a as Error)?.message ?? a)).join(" "));
/** Observations printed for the report (vitest shows them under the test). */
const note = (label: string, o: unknown) => console.log(`[obs] ${label}: ${JSON.stringify(o)}`);

/** The text of a node, with the shadow roots of the elements in it concatenated in place. */
function deepText(n: Node): string {
  if (n.nodeType === 3) return (n as Text).data;
  if (n.nodeType === 8) return "";
  let s = "";
  const sr = (n as Element).shadowRoot;
  if (sr) for (const c of Array.from(sr.childNodes)) s += deepText(c);
  for (const c of Array.from(n.childNodes)) s += deepText(c);
  return s;
}

// ---------------------------------------------------------------- #384

describe("#384 行の部品の shadow の中で、for: の外に書いた state: . は、形を指す診断で報告される（書いていないパスで報告されない）", () => {
  const inners: [string, () => Record<string, any>][] = [
    ["中の部品が私有キーを持つ（{ seen: \"-\" }）", () => ({ seen: "-" })],
    ["中の部品が $connectedCallback を持つ", () => ({ $connectedCallback(this: any) { void this.name; } })],
    ["中の部品が自分の state を持たない（{}）", () => ({})],
  ];

  it.each(inners)("%s", async (label, innerState) => {
    const inner = component(`<i>{{ name }}</i><s>{{ seen }}</s>`, innerState);
    const outer = component(`<b>{{ name }}</b>:<${inner} data-wcs="state: ."></${inner}>`, () => ({}));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { root, write } = await page(`<template data-wcs="for: users"><${outer} data-wcs="state: ."></${outer}>|</template>`, {
        users: [{ name: "a" }, { name: "b" }],
      });
      await sleep(10);
      const shown = () => Array.from(root.querySelectorAll(outer)).map((o) => deepText(o));
      const loaded = shown();
      await write((s) => { s["users.0.name"] = "A"; });
      await sleep(10);
      const after = shown();
      const errors = messagesOf(error);
      const warns = messagesOf(warn);
      note(`#384 ${label}`, { loaded, after, errors, warns });
      // 外の部品の {{ name }} は描かれ、追従する
      expect(loaded.map((t) => t.split(":")[0])).toEqual(["a", "b"]);
      expect(after.map((t) => t.split(":")[0])).toEqual(["A", "b"]);
      // 報告は書いた形（"." が for: の外にある）を指す
      const all = [...errors, ...warns].join("\n");
      expect(all).toContain(`"." is relative: it needs an enclosing "for" template`);
      // 書いていないパス（users.*.. / users.*.*.*）で報告しない
      expect(all).not.toMatch(/users\.\*\.\.|users\.\*\.\*\.\*/);
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("（追加・4.0 の一般の扱い）束縛の構文の誤りは部品の走査を止める: state: . を shadow の先頭に置くと、後ろの {{ name }} も束縛されず、$connectedCallback も走らない", async () => {
    const inner = component(`<i>{{ name }}</i>`, () => ({}));
    let connected = 0;
    const outer = component(`<${inner} data-wcs="state: ."></${inner}>:<b>{{ name }}</b>`, () => ({ $connectedCallback() { connected++; } }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { root } = await page(`<template data-wcs="for: users"><${outer} data-wcs="state: ."></${outer}>|</template>`, {
        users: [{ name: "a" }, { name: "b" }],
      });
      await sleep(10);
      const shown = Array.from(root.querySelectorAll(outer)).map((o) => deepText(o));
      note("#384 先頭に置いた形", { shown, connected, errors: messagesOf(error), warns: messagesOf(warn) });
      // 未知のフィルタ・構文の誤り・for の外の .x と同じく、最初の誤りで走査が止まる（それより前の束縛だけが生きる）
      expect(shown).toEqual(["{{ name }}:{{ name }}", "{{ name }}:{{ name }}"]);
      expect(connected).toBe(0);
      expect(messagesOf(error).every((m) => m.includes(`"." is relative: it needs an enclosing "for" template`))).toBe(true);
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("（対照）トップレベル（ページの直下、for: の外）の state: . も、形を指す診断になる", async () => {
    const inner = component(`<i>{{ name }}</i>`, () => ({}));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { root, el } = await page(`<p>{{ title }}</p><${inner} data-wcs="state: ."></${inner}><q>{{ title }}</q>`, { title: "t", name: "n" });
      await sleep(10);
      const obs = { p: root.querySelector("p")!.textContent, q: root.querySelector("q")!.textContent, engine: el.engine !== null, errors: messagesOf(error), warns: messagesOf(warn) };
      note("#384 トップレベル", obs);
      expect([...obs.errors, ...obs.warns].join("\n")).toContain(`"." is relative: it needs an enclosing "for" template`);
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("（対照）行の部品の shadow の中の for: tags の中の state: . と、部分マウント state.name: name は正しく動く", async () => {
    const tagCmp = component(`<i>{{ label }}</i>`, () => ({}));
    const nameCmp = component(`<u>{{ name }}</u>`, () => ({}));
    const outer = component(
      `<b>{{ name }}</b>:<template data-wcs="for: tags"><${tagCmp} data-wcs="state: ."></${tagCmp}></template>:<${nameCmp} data-wcs="state.name: name"></${nameCmp}>`,
      () => ({}),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, write } = await page(`<template data-wcs="for: users"><${outer} data-wcs="state: ."></${outer}>|</template>`, {
        users: [{ name: "a", tags: [{ label: "x" }, { label: "y" }] }, { name: "b", tags: [] }],
      });
      await sleep(10);
      const shown = () => Array.from(root.querySelectorAll(outer)).map((o) => deepText(o));
      expect(shown()).toEqual(["a:xy:a", "b::b"]);
      await write((s) => { s["users.0.name"] = "A"; s["users.0.tags.1.label"] = "Y"; });
      await sleep(10);
      expect(shown()).toEqual(["A:xY:A", "b::b"]);
      expect(messagesOf(error)).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });
});

// ---------------------------------------------------------------- #385

describe("#385 for: の行に完全マウントした部品が私有キーを描いていても、リストを置き換えられる（費用は bench/issues2.perf.test.ts）", () => {
  it("state: . の行の部品（私有キー＋$connectedCallback）: 置き換えを 3 回（間に users = []）しても、どの行も自分の名前と私有キーを描く", async () => {
    const tag = component(`<span>{{ name }}</span><i>{{ seen }}</i>`, () => ({ seen: "-", $connectedCallback(this: any) { this.seen = "saw " + this.name; } }));
    const { root, write } = await page(`<div><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`, { users: [] });
    const shown = () => Array.from(root.querySelectorAll(tag)).map((e) => deepText(e)).join(",");
    const make = (round: number) => Array.from({ length: 50 }, (_, i) => ({ name: `r${round}-${i}` }));
    for (let round = 1; round <= 3; round++) {
      await write((s) => { s.users = []; });
      await write((s) => { s.users = make(round); });
      await sleep(10);
      expect(shown()).toBe(make(round).map((u) => `${u.name}saw ${u.name}`).join(","));
    }
  });
});

// ---------------------------------------------------------------- #386

describe("#386 行の要素の書き込みで行を差し替えても、完全マウントの部品が $connectedCallback で控えた私有キーは失われない", () => {
  it.each(["state: .", "state.name: .name"])("%s", async (wiring) => {
    let tidSeq = 0;
    const log: string[] = [];
    const tag = component(`<b>{{ name }}/{{ tid }}</b>`, () => ({
      tid: 0,
      $connectedCallback(this: any) { this.tid = ++tidSeq; log.push(`conn:${this.name}:tid=${this.tid}`); },
      $disconnectedCallback(this: any) { log.push(`disc:tid=${this.tid}`); },
    }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root, write } = await page(`<template data-wcs="for: users"><${tag} data-wcs="${wiring}"></${tag}>|</template>`, {
        users: [{ name: "Anna" }, { name: "Ben" }, { name: "Cy" }],
      });
      await flush();
      const els = () => Array.from(root.querySelectorAll(tag)) as any[];
      const shown = () => els().map((e) => `${e.shadowRoot.querySelector("b").textContent}|`).join("");
      const loaded = { shown: shown(), log: [...log] };
      const ben = els()[1];
      log.length = 0;
      await write((s) => { s["users.1"] = { name: "Dan" }; });
      await flush();
      const replaced = { shown: shown(), log: [...log], sameElement: els()[1] === ben, tid: ben.state.tid };
      log.length = 0;
      await write((s) => { s.users = [s.users[0], s.users[2]]; });
      await flush();
      const removed = { shown: shown(), log: [...log] };
      note(`#386 ${wiring}`, { loaded, replaced, removed, errors: messagesOf(error) });
      expect(loaded.shown).toBe("Anna/1|Ben/2|Cy/3|");
      expect(loaded.log).toEqual(["conn:Anna:tid=1", "conn:Ben:tid=2", "conn:Cy:tid=3"]);
      expect(replaced.shown).toBe("Anna/1|Dan/2|Cy/3|");
      expect(replaced.tid).toBe(2);
      expect(removed.log).toEqual(["disc:tid=2"]);
      expect(removed.shown).toBe("Anna/1|Cy/3|");
      expect(messagesOf(error)).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });

  it("（追加）行を丸ごと新しい配列で差し替える（s.users = [s.users[0], { name: \"Dan\" }, s.users[2]]）: 前の要素が外れ、新しい要素が接続する", async () => {
    let tidSeq = 0;
    const log: string[] = [];
    const tag = component(`<b>{{ name }}/{{ tid }}</b>`, () => ({
      tid: 0,
      $connectedCallback(this: any) { this.tid = ++tidSeq; log.push(`conn:${this.name}:tid=${this.tid}`); },
      $disconnectedCallback(this: any) { log.push(`disc:tid=${this.tid}`); },
    }));
    const { root, write } = await page(`<template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}>|</template>`, {
      users: [{ name: "Anna" }, { name: "Ben" }, { name: "Cy" }],
    });
    await flush();
    const shown = () => Array.from(root.querySelectorAll(tag)).map((e: any) => `${e.shadowRoot.querySelector("b").textContent}|`).join("");
    log.length = 0;
    await write((s) => { s.users = [s.users[0], { name: "Dan" }, s.users[2]]; });
    await flush();
    note("#386 配列の置き換えで差し替え", { shown: shown(), log });
    expect(shown()).toBe("Anna/1|Dan/4|Cy/3|");
    expect(log).toEqual(["disc:tid=2", "conn:Dan:tid=4"]);
  });
});

// ---------------------------------------------------------------- #387

describe("#387 束縛を持つ要素を別の root へ移しても、2 つの root のどちらが先に作られたかで振る舞いが変わらない", () => {
  it("B（後に作った root）の要素を A へ、A の要素を B へ移す", async () => {
    const late = `issues2-c-late-${seq++}`;
    async function makeRoot(label: string) {
      const host = document.createElement("div");
      host.id = "host" + label;
      document.body.append(host);
      const sr = host.attachShadow({ mode: "open" });
      sr.innerHTML = `<wcs-state json='{"name":"${label}0"}'></wcs-state>`
        + `<div id="box"><span data-wcs="textContent: name"></span><${late} data-wcs="name: name"></${late}></div><div id="dest"></div>`;
      const el = sr.querySelector("wcs-state") as any;
      await el.connectedCallbackPromise;
      await getBindingsReady(sr);
      return { host, sr, el, box: sr.getElementById("box")!, write: (v: string) => el.createState("writable", (s: any) => { s.name = v; }) };
    }
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const A = await makeRoot("A");
      await sleep(20);
      const B = await makeRoot("B");
      await sleep(20);
      const fromB = B.box; // B の box → A
      const fromA = A.box; // A の box → B
      const shownOf = (box: Element) => ({ span: box.querySelector("span")!.textContent, late: box.querySelector(late)!.textContent });
      const obs: Record<string, unknown> = {};
      obs.before = { fromB: shownOf(fromB), fromA: shownOf(fromA) };
      A.sr.getElementById("dest")!.append(fromB);
      await sleep(10);
      A.write("A1"); B.write("B1");
      await sleep(10);
      obs.movedBtoA = { fromB: shownOf(fromB), fromA: shownOf(fromA) };
      B.sr.getElementById("dest")!.append(fromA);
      await sleep(10);
      A.write("A2"); B.write("B2");
      await sleep(10);
      obs.movedAtoB = { fromB: shownOf(fromB), fromA: shownOf(fromA) };
      customElements.define(late, class extends HTMLElement {
        static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], inputs: [{ name: "name" }] };
        v: unknown;
        set name(v: unknown) { this.v = v; this.textContent = `late:${v}`; }
        get name(): unknown { return this.v; }
      });
      await sleep(10);
      obs.defined = { fromB: shownOf(fromB), fromA: shownOf(fromA) };
      A.write("A3"); B.write("B3");
      await sleep(10);
      obs.written3 = { fromB: shownOf(fromB), fromA: shownOf(fromA) };
      note("#387", { ...obs, errors: messagesOf(error) });
      const f = obs as any;
      // 止まらない: 移した要素は、どちらの向きでも書き込みに追従する（state-next では元の root の state に）
      expect(f.written3.fromB.span).not.toBe("B0");
      expect(f.written3.fromA.span).not.toBe("A0");
      expect(f.written3.fromB.late).not.toBe("");
      expect(f.written3.fromA.late).not.toBe("");
      // 向きによらず同じ振る舞い: どちらも、元の root の値か、どちらも行き先の root の値
      const followsOrigin = f.written3.fromB.span === "B3" && f.written3.fromA.span === "A3";
      const followsDest = f.written3.fromB.span === "A3" && f.written3.fromA.span === "B3";
      expect(followsOrigin || followsDest).toBe(true);
      expect(messagesOf(error)).toEqual([]);
      A.host.remove();
      B.host.remove();
    } finally {
      error.mockRestore();
    }
  });

  it.fails("（追加）移した要素の onclick（委譲されるイベント）と双方向の入力も、移した後に動く", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      async function makeRoot(label: string) {
        const host = document.createElement("div");
        const sr = host.attachShadow({ mode: "open" });
        sr.innerHTML = `<wcs-state></wcs-state>`
          + `<div id="box"><button data-wcs="onclick: bump">+</button><input data-wcs="value: text"><output>{{ n }}</output></div><div id="dest"></div>`;
        const el = sr.querySelector("wcs-state") as any;
        el.setInitialState({ n: 0, text: label, bump(this: any) { this.n++; } });
        document.body.append(host);
        await el.connectedCallbackPromise;
        await getBindingsReady(sr);
        return { host, sr, el, read: (p: string) => { let v: unknown; el.createState("readonly", (s: any) => { v = s[p]; }); return v; } };
      }
      const A = await makeRoot("A");
      const B = await makeRoot("B");
      const box = B.sr.getElementById("box")!;
      (box.querySelector("button") as HTMLElement).click();
      await flush();
      const beforeMove = B.read("n");
      A.sr.getElementById("dest")!.append(box);
      await flush();
      (box.querySelector("button") as HTMLElement).click();
      const input = box.querySelector("input") as HTMLInputElement;
      input.value = "typed";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
      await flush();
      const obs = { beforeMove, afterMoveB: B.read("n"), afterMoveA: A.read("n"), textB: B.read("text"), textA: A.read("text"), output: box.querySelector("output")!.textContent, errors: messagesOf(error) };
      note("#387 イベントと双方向の入力", obs);
      expect(beforeMove).toBe(1);
      expect(obs.textB === "typed" || obs.textA === "typed").toBe(true);
      // 期待: 移した後のクリックも、どちらかの root のハンドラに届く
      expect((obs.afterMoveB as number) + (obs.afterMoveA as number)).toBe(2);
      A.host.remove();
      B.host.remove();
    } finally {
      error.mockRestore();
    }
  });
});

// ---------------------------------------------------------------- #391

describe("#391 自己再帰の部品の木（for: children の行に state: .）: マウントと葉の 100 回の更新、再評価は祖先の経路に限る", () => {
  async function mountTree(depth: number, onEvaluate: (label: string) => void) {
    const tag = `issues2-c-tree-${seq++}`;
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

  const cases = [2, 3].map((d) => [d, "終わるまで待つ（時間は bench/issues2.perf.test.ts）"] as const);
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
});
