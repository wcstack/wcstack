/**
 * issues2-ssr.test.ts — 現行 @wcstack/state 3.3 の SSR ハイドレーションの Issue
 * （#372 #373 #374 #375）の再現手順を state-next で流す。
 * 各 Issue の「期待」（CSR と同じ表示）を、CSR（enable-ssr なし）と SSR ＋ハイドレーション
 * （orchestrated: `data-wcs-server="orchestrated"` とスナップショットの組み立て役の最終パス）の
 * 両方で確かめる。#374 の inline の形（`data-wcs-server=""`、組み立て役を呼ばない
 * 古いレンダラ）は、4.0 が inline のスナップショットを持たない（承認済みの簡素化、
 * src/ssr/ssr.ts の冒頭）ので、その形で何が起きるかを別に確かめる。
 * 旧フィルタ名は 4.0 に無いので、`uc` は `upper`、`inc(1)` は `add(1)` に読み替えた。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, installFormats, scopes, ssr } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes, ssr]);
  installFormats();
  bootstrapState();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`issue2-page-${seq++}`);
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

/**
 * Renders `html` as the server does; its HTML. `orchestrated` (@wcstack/server 1.32+): the
 * snapshot builder runs last. `inline` (an older renderer, or a custom one with
 * `data-wcs-server=""`): nobody calls the builder.
 */
async function serverRender(html: string, state: Record<string, any>, how: "orchestrated" | "inline" = "orchestrated"): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", how === "orchestrated" ? "orchestrated" : "");
  try {
    const h = document.createElement(`issue2-server-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    await flush();
    if (how === "orchestrated") (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
    const out = root.innerHTML;
    h.remove();
    return out;
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
}

/** Loads the server's HTML and hydrates it; `before` sees the page before the state loads. */
async function hydrate(html: string, state: Record<string, any>, before?: (root: ShadowRoot) => void) {
  const h = document.createElement(`issue2-client-${seq++}`);
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
  /** SSR: these server nodes must be adopted (still connected after the hydration). */
  adopt?: string;
  /** SSR: how the server renders (default orchestrated). */
  how?: "orchestrated" | "inline";
  /** SSR: sees the server's output. */
  out?: (html: string) => void;
}
type Loaded = { root: ShadowRoot; write: (fn: (s: any) => void) => Promise<void>; out?: string };
type Load = (html: string, state: () => Record<string, any>, opts?: Opts) => Promise<Loaded>;

/** CSR: the same markup without enable-ssr. */
const csr: Load = async (html, state) => page(html, state());

/** SSR: rendered on the server (`<wcs-state enable-ssr>`), then hydrated on the client. */
const ssrLoad: Load = async (html, state, opts) => {
  const how = opts?.how ?? "orchestrated";
  const out = await serverRender(`<wcs-state enable-ssr></wcs-state>${html}`, state(), how);
  if (how === "orchestrated") expect(out).toContain("<wcs-ssr");
  opts?.out?.(out);
  // WCS_DUMP=<file>: appends each server output to the file (happy-dom's console does not reach stdout)
  if (process.env.WCS_DUMP) (await import("node:fs")).appendFileSync(process.env.WCS_DUMP, `---- ${expect.getState().currentTestName}
${out}
`);
  let serverNodes: Element[] = [];
  const p = await hydrate(out, state(), (r) => { if (opts?.adopt) serverNodes = Array.from(r.querySelectorAll(opts.adopt)); });
  if (opts?.adopt) {
    expect(serverNodes.length).toBeGreaterThan(0);
    for (const n of serverNodes) expect(n.isConnected).toBe(true);
  }
  return { ...p, out };
};

const modes: [string, Load][] = [["CSR", csr], ["SSR", ssrLoad]];

/** The visible text under `n` (templates / scripts left out), every whitespace removed. */
function flat(n: Node | null): string {
  if (n === null) return "<none>";
  const out: string[] = [];
  const walk = (p: Node): void => {
    for (const c of Array.from(p.childNodes)) {
      if (c.nodeType === 3) out.push((c as Text).data);
      else if (c.nodeType === 1 && !["template", "script", "style"].includes((c as Element).localName)) walk(c);
    }
  };
  walk(n);
  return out.join("").replace(/\s+/g, "");
}
const rootText = (root: ParentNode) => flat(root.querySelector("#root"));
const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => flat(n));

/** Collects console.error / console.warn and uncaught errors while `fn` runs. */
async function capture<T>(fn: () => Promise<T>): Promise<{ result: T; errors: string[]; warns: string[] }> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const msg = (x: unknown[]) => x.map((a) => String((a as Error)?.message ?? a)).join(" ");
  const uncaught: string[] = [];
  const onError = (e: any) => { uncaught.push(String(e?.error?.message ?? e?.message ?? e)); e.preventDefault?.(); };
  const onRejection = (e: any) => { uncaught.push(String(e?.reason?.message ?? e?.reason ?? e)); e.preventDefault?.(); };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  try {
    const result = await fn();
    return { result, errors: [...error.mock.calls.map(msg), ...uncaught], warns: warn.mock.calls.map(msg) };
  } catch (e) {
    const errs = [...error.mock.calls.map(msg), ...uncaught];
    if (e instanceof Error && errs.length > 0) e.message += `\n[console.error] ${errs.join(" | ").slice(0, 600)}`;
    throw e;
  } finally {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    error.mockRestore();
    warn.mockRestore();
  }
}

/** Runs `steps` (each a write, then a read) and returns what each read saw. */
async function run(p: Loaded, read: (root: ShadowRoot) => string, steps: ((s: any) => void)[]): Promise<string[]> {
  const seen = [read(p.root)];
  for (const s of steps) {
    await p.write(s);
    seen.push(read(p.root));
  }
  return seen;
}

// ---------------------------------------------------------------- #372

describe("#372 SSR のハイドレーション後、Light DOM の bind-component の子（部分マウント）の中の {{ }} と for: が書き込みに追従する", () => {
  let kid = "";
  let priv = "";
  beforeAll(() => {
    kid = `issue2-kid-${seq++}`;
    customElements.define(kid, class extends HTMLElement { state = {}; });
    priv = `issue2-priv-${seq++}`;
    customElements.define(priv, class extends HTMLElement { state = { nums: [1, 2] }; });
  });

  describe.each(modes)("%s", (_mode, load) => {
    it("1. 子の {{ x }}（別名の配線 state.x: v）", async () => {
      let out = "";
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><${kid} data-wcs="state.x: v"><wcs-state bind-component="state"></wcs-state><b>{{ x }}</b></${kid}></div>`,
          () => ({ v: "one" }), { adopt: "b", out: (o) => { out = o; } });
        return run(p, rootText, [(s) => { s.v = "two"; }]);
      });
      if (out !== "") expect(out).toContain("<!--wcs-t:x-->one<!--wcs-/t-->");
      expect(result).toEqual(["one", "two"]);
      expect(errors).toEqual([]);
    });

    it("2. 子の for: items（同名の配線 state.items: items）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><${kid} data-wcs="state.items: items"><wcs-state bind-component="state"></wcs-state>
  <ul><template data-wcs="for: items"><li data-wcs="textContent: .id"></li></template></ul></${kid}></div>`,
        () => ({ items: [{ id: "a" }, { id: "b" }] }));
        return run(p, rootText, [
          (s) => { s["items.0.id"] = "A"; },
          (s) => { s.items = [...s.items, { id: "c" }]; },
        ]);
      });
      expect(result).toEqual(["ab", "Ab", "Abc"]);
      expect(errors).toEqual([]);
    });

    it("3. 子の for: rows（別名の配線 state.rows: list）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><${kid} data-wcs="state.rows: list"><wcs-state bind-component="state"></wcs-state>
  <ul><template data-wcs="for: rows"><li data-wcs="textContent: .id"></li></template></ul></${kid}></div>`,
        () => ({ list: [{ id: "a" }, { id: "b" }] }));
        return run(p, rootText, [
          (s) => { s["list.0.id"] = "A"; },
          (s) => { s.list = [...s.list, { id: "c" }]; },
        ]);
      });
      expect(result).toEqual(["ab", "Ab", "Abc"]);
      expect(errors).toEqual([]);
    });

    it("3'. ホストの for: items と、子の for: items（state.items: other・別の配列）を並べた形", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><ul class="h"><template data-wcs="for: items"><li data-wcs="textContent: .id"></li></template></ul>
  <${kid} data-wcs="state.items: other"><wcs-state bind-component="state"></wcs-state>
  <ul class="k"><template data-wcs="for: items"><li data-wcs="textContent: .id"></li></template></ul></${kid}></div>`,
        () => ({ items: [{ id: "a" }, { id: "b" }], other: [{ id: "x" }, { id: "y" }] }));
        const read = (r: ShadowRoot) => `${flat(r.querySelector("ul.h"))}/${flat(r.querySelector("ul.k"))}`;
        return run(p, read, [
          (s) => { s["other.0.id"] = "X"; },
          (s) => { s.other = [...s.other, { id: "z" }]; },
          (s) => { s["items.1.id"] = "B"; },
        ]);
      });
      expect(result).toEqual(["ab/xy", "ab/Xy", "ab/Xyz", "aB/Xyz"]);
      expect(errors).toEqual([]);
    });

    it("4. 子が自分の私有リストを描く（state = { nums: [1, 2] }、for: nums）と、子の外の {{ x }}", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><${priv} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state>
  <ul><template data-wcs="for: nums"><li>{{ . }}</li></template></ul></${priv}><p>{{ x }}</p></div>`,
        () => ({ x: 1 }), { adopt: "p" });
        return run(p, rootText, [(s) => { s.x = 2; }]);
      });
      expect(result).toEqual(["121", "122"]);
      expect(errors).toEqual([]);
    });

    it("対照: 子の中の属性の束縛（別名の配線）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><${kid} data-wcs="state.x: v"><wcs-state bind-component="state"></wcs-state><b data-wcs="textContent: x"></b></${kid}></div>`,
          () => ({ v: "one" }), { adopt: "b" });
        return run(p, rootText, [(s) => { s.v = "two"; }]);
      });
      expect(result).toEqual(["one", "two"]);
      expect(errors).toEqual([]);
    });

    it("対照: 同名の配線の子の {{ x }}（state.x: x）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state><b>{{ x }}</b></${kid}></div>`,
          () => ({ x: "one" }), { adopt: "b" });
        return run(p, rootText, [(s) => { s.x = "two"; }]);
      });
      expect(result).toEqual(["one", "two"]);
      expect(errors).toEqual([]);
    });

    // Issue の表に無い追加の形: 子の {{ }} にフィルタ（#373 と同じ行が原因と推定されている組み合わせ）
    it("追加: 子の {{ x|upper }}（別名の配線）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><${kid} data-wcs="state.x: v"><wcs-state bind-component="state"></wcs-state><b>{{ x|upper }}</b></${kid}></div>`,
          () => ({ v: "one" }), { adopt: "b" });
        return run(p, rootText, [(s) => { s.v = "two"; }]);
      });
      expect(result).toEqual(["ONE", "TWO"]);
      expect(errors).toEqual([]);
    });

    // 追加の形: 子の for: の行の {{ }}（別名）と、子から一覧への書き込み
    it("追加: 子の for: rows の行の {{ .id }} と、子の要素からの書き込み", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><${kid} data-wcs="state.rows: list"><wcs-state bind-component="state"></wcs-state>
  <ul><template data-wcs="for: rows"><li>{{ .id }}</li></template></ul></${kid}></div>`,
        () => ({ list: [{ id: "a" }, { id: "b" }] }));
        const seen = await run(p, rootText, [
          (s) => { s["list.1.id"] = "B"; },
          (s) => { s.list = s.list.slice(1); },
        ]);
        (p.root.querySelector(kid) as any).state.rows = [{ id: "k" }, { id: "m" }];
        await flush();
        await flush();
        seen.push(rootText(p.root));
        return seen;
      });
      expect(result).toEqual(["ab", "aB", "B", "km"]);
      expect(errors).toEqual([]);
    });

    // 追加の形: 子をページの for: の行に置き、子の {{ }}（別名）と子の for:（行からの別名）を持たせる
    it("追加: ページの for: の行の中の子の {{ t }} と for: items（state.t: .title; state.items: .list）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><ul><template data-wcs="for: groups"><li><${kid} data-wcs="state.t: .title; state.items: .list"><wcs-state bind-component="state"></wcs-state><b>{{ t }}</b>:<template data-wcs="for: items"><i>{{ . }}</i></template></${kid}></li></template></ul></div>`,
          () => ({ groups: [{ title: "g", list: [1, 2] }, { title: "h", list: [3] }] }), { adopt: "li" });
        return run(p, (r) => texts(r, "li").join(" "), [
          (s) => { s["groups.1.title"] = "H"; },
          (s) => { s["groups.0.list"] = [9]; },
          (s) => { s.groups = [...s.groups, { title: "k", list: [] }]; },
          (s) => { s.groups = [...s.groups].reverse(); },
        ]);
      });
      expect(result).toEqual(["g:12 h:3", "g:12 H:3", "g:9 H:3", "g:9 H:3 k:", "k: H:3 g:9"]);
      expect(errors).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------- #373

describe("#373 SSR のハイドレーション後、{{ }} のテキストが出力フィルタを保つ（uc → upper、inc(1) → add(1)）", () => {
  const html = `<div id="root">
  <p>{{ name|upper }}</p>
  <ul><template data-wcs="for: items"><li>{{ .id|upper }}#{{ $1|add(1) }}</li></template></ul>
</div>`;
  const state = () => ({ name: "a", items: [{ id: "a" }, { id: "b" }] });
  const read = (r: ShadowRoot) => `${flat(r.querySelector("p"))}/${flat(r.querySelector("ul"))}`;

  describe.each(modes)("%s", (_mode, load) => {
    it("Issue の手順", async () => {
      let out = "";
      const { result, errors } = await capture(async () => {
        const p = await load(html, state, { adopt: "li", out: (o) => { out = o; } });
        return run(p, read, [
          (s) => { s.name = "b"; },
          (s) => { s["items.0.id"] = "c"; },
          (s) => { s.items = [...s.items, { id: "z" }]; },
        ]);
      });
      expect(result).toEqual(["A/A#1B#2", "B/A#1B#2", "B/C#1B#2", "B/C#1B#2Z#3"]);
      expect(errors).toEqual([]);
      // the server's output keeps the whole expression (filters included) on the page-level text
      if (out !== "") expect(out).toContain(`<!--wcs-t:${encodeURIComponent("name|upper")}-->A<!--wcs-/t-->`);
    });

    it("サーバーの値（A）のまま引き取り、初回の適用で書き換わらない（ちらつかない）", async () => {
      const seen: string[] = [];
      const p = await load(html, state, {});
      // after the hydration, the server's text nodes still carry the filtered values
      seen.push(read(p.root));
      expect(seen).toEqual(["A/A#1B#2"]);
    });

    it("対照: 属性の束縛（textContent: name|upper）", async () => {
      const p = await load(`<div id="root"><p data-wcs="textContent: name|upper"></p></div>`, () => ({ name: "a" }), { adopt: "p" });
      expect(await run(p, rootText, [(s) => { s.name = "b"; }])).toEqual(["A", "B"]);
    });
  });

  it("SSR: 引き取ったテキストノードは、ハイドレーションの間に一度もフィルタの無い値にならない", async () => {
    const out = await serverRender(`<wcs-state enable-ssr></wcs-state>${html}`, state());
    const values: string[] = [];
    const h = await hydrate(out, state(), (r) => {
      const obs = new MutationObserver((ms) => {
        for (const m of ms) if (m.type === "characterData") values.push((m.target as Text).data);
      });
      obs.observe(r, { subtree: true, characterData: true });
    });
    await flush();
    expect(read(h.root)).toBe("A/A#1B#2");
    // lower-case letters and "0" would be the unfiltered values ("1" is also row 0's filtered one)
    expect(values.filter((v) => /^[ab0]$/.test(v))).toEqual([]);
  });
});

// ---------------------------------------------------------------- #374

describe("#374 ページの if: の枝・for: の行の中の Light DOM の bind-component の子が持つ if: が、ハイドレーション後に追従する", () => {
  let kid = "";
  let kid2 = "";
  beforeAll(() => {
    kid = `issue2-kid-${seq++}`;
    customElements.define(kid, class extends HTMLElement { state = {}; });
    kid2 = `issue2-kid-${seq++}`;
    customElements.define(kid2, class extends HTMLElement { state = {}; });
  });
  const shown = (root: ParentNode) => flat(root.querySelector("#root"));

  describe.each(modes)("%s（orchestrated）", (_mode, load) => {
    it("Issue の形: if: a の枝の中の子の if: x / else:", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root">
  <template data-wcs="if: a">
    <div>A <${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state>
      <template data-wcs="if: x"><i>X</i></template><template data-wcs="else:"><s>nX</s></template>
    </${kid}></div>
  </template>
</div>`, () => ({ a: true, x: true }));
        return run(p, shown, [(s) => { s.x = false; }, (s) => { s.x = true; }]);
      });
      expect(result).toEqual(["AX", "AnX", "AX"]);
      expect(errors).toEqual([]);
    });

    it("子を for: の行に置く（state.x: .x）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><ul><template data-wcs="for: items"><li><${kid} data-wcs="state.x: .x"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template><template data-wcs="else:"><s>nX</s></template></${kid}></li></template></ul></div>`,
          () => ({ items: [{ x: true }, { x: false }] }), { adopt: "li" });
        return run(p, shown, [
          (s) => { s["items.0.x"] = false; },
          (s) => { s["items.1.x"] = true; },
          (s) => { s.items = [...s.items, { x: true }]; },
          (s) => { s.items = [...s.items].reverse(); },
        ]);
      });
      expect(result).toEqual(["XnX", "nXnX", "nXX", "nXXX", "XXnX"]);
      expect(errors).toEqual([]);
    });

    it("子の if: に elseif: の連鎖", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root">
  <template data-wcs="if: a">
    <div>A <${kid} data-wcs="state.v: v"><wcs-state bind-component="state"></wcs-state>
      <template data-wcs="if: v|gt(0)"><i>P</i></template><template data-wcs="elseif: v|lt(0)"><i>N</i></template><template data-wcs="else:"><s>Z</s></template>
    </${kid}></div>
  </template>
</div>`, () => ({ a: true, v: 1 }));
        return run(p, shown, [(s) => { s.v = -1; }, (s) => { s.v = 0; }, (s) => { s.v = 2; }]);
      });
      expect(result).toEqual(["AP", "AN", "AZ", "AP"]);
      expect(errors).toEqual([]);
    });

    it("子の中にさらに子（孫の if: y / else:、state.y: x）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root">
  <template data-wcs="if: a">
    <div>A <${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state>
      <${kid2} data-wcs="state.y: x"><wcs-state bind-component="state"></wcs-state>
        <template data-wcs="if: y"><i>Y</i></template><template data-wcs="else:"><s>nY</s></template>
      </${kid2}>
    </${kid}></div>
  </template>
</div>`, () => ({ a: true, x: true }));
        return run(p, shown, [(s) => { s.x = false; }, (s) => { s.x = true; }, (s) => { s.a = false; }, (s) => { s.a = true; }]);
      });
      expect(result).toEqual(["AY", "AnY", "AY", "", "AY"]);
      expect(errors).toEqual([]);
    });

    it("対照: 子がページの直下（if: / for: の外）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root">A <${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template><template data-wcs="else:"><s>nX</s></template></${kid}></div>`,
          () => ({ x: true }));
        return run(p, shown, [(s) => { s.x = false; }, (s) => { s.x = true; }]);
      });
      expect(result).toEqual(["AX", "AnX", "AX"]);
      expect(errors).toEqual([]);
    });
  });

  // 4.0 は inline のスナップショットを作らない（src/ssr/ssr.ts の冒頭「Not carried over … the inline snapshot」）。
  // 古いレンダラ（組み立て役を呼ばない、data-wcs-server=""）と組んだときに何が起きるかを確かめる。
  describe("inline（data-wcs-server=\"\"、組み立て役を呼ばない）", () => {
    const html = `<div id="root">
  <template data-wcs="if: a">
    <div>A <${"KID"} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state>
      <template data-wcs="if: x"><i>X</i></template><template data-wcs="else:"><s>nX</s></template>
    </${"KID"}></div>
  </template>
</div>`;

    // 対象外: 4.0 は inline のスナップショットを作らない（src/ssr/ssr.ts の冒頭、承認済み）。症状として残す
    it.fails("Issue の期待: s.x = false で A nX（inline でも orchestrated と同じ）", async () => {
      const { result } = await capture(async () => {
        const p = await ssrLoad(html.replaceAll("KID", kid), () => ({ a: true, x: true }), { how: "inline" });
        return run(p, shown, [(s) => { s.x = false; }, (s) => { s.x = true; }]);
      });
      expect(result).toEqual(["AX", "AnX", "AX"]);
    });

    it("実際: サーバーの出力に <wcs-ssr> が無く、ページの直下の if: も {{ }} も追従しない", async () => {
      let out = "";
      const { result, errors, warns } = await capture(async () => {
        const p = await ssrLoad(`<div id="root"><p>{{ name }}</p><template data-wcs="if: a"><b>on</b></template><template data-wcs="else:"><s>off</s></template></div>`,
          () => ({ name: "n", a: true }), { how: "inline", out: (o) => { out = o; } });
        return run(p, shown, [(s) => { s.name = "m"; }, (s) => { s.a = false; }]);
      });
      expect(out).not.toContain("<wcs-ssr");
      // what the client shows: the server's output, frozen (CSR would give ["non", "mon", "moff"])
      expect({ result, errors, warns }).toEqual({ result: ["non", "non", "non"], errors: [], warns: [] });
    });
  });
});

// ---------------------------------------------------------------- #375

describe("#375 SSR のハイドレーション後、if: / elseif: だけが読む getter の条件が、getter の入力の書き込みで切り替わる", () => {
  describe.each(modes)("%s", (_mode, load) => {
    it("トップレベルの getter（if: loggedIn / else:）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root">
  <template data-wcs="if: loggedIn"><p>welcome</p></template>
  <template data-wcs="else:"><p>please log in</p></template>
</div>`, () => ({ user: null, get loggedIn() { return (this as any).user !== null; } }), { adopt: "p" });
        return run(p, rootText, [(s) => { s.user = { name: "a" }; }, (s) => { s.user = null; }]);
      });
      expect(result).toEqual(["pleaselogin", "welcome", "pleaselogin"]);
      expect(errors).toEqual([]);
    });

    it("elseif: の getter（if: pos / elseif: neg / else:）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root">
  <template data-wcs="if: pos"><p>pos</p></template><template data-wcs="elseif: neg"><p>neg</p></template><template data-wcs="else:"><p>zero</p></template>
</div>`, () => ({ v: 0, get pos() { return (this as any).v > 0; }, get neg() { return (this as any).v < 0; } }), { adopt: "p" });
        return run(p, rootText, [(s) => { s.v = 1; }, (s) => { s.v = -1; }, (s) => { s.v = 0; }]);
      });
      expect(result).toEqual(["zero", "pos", "neg", "zero"]);
      expect(errors).toEqual([]);
    });

    it("行 getter（if: .big）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><ul><template data-wcs="for: items"><li>{{ .n }}<template data-wcs="if: .big"><b>!</b></template></li></template></ul></div>`,
          () => ({ items: [{ n: 1 }, { n: 5 }], get "items.*.big"() { return (this as any)["items.*.n"] > 3; } }), { adopt: "li" });
        return run(p, (r) => texts(r, "li").join(" "), [(s) => { s["items.0.n"] = 9; }, (s) => { s["items.1.n"] = 0; }]);
      });
      expect(result).toEqual(["1 5!", "9! 5!", "9! 0"]);
      expect(errors).toEqual([]);
    });

    it("$1 を読む行 getter（if: .first）: 並べ替え", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><ul><template data-wcs="for: items"><li>{{ .name }}<template data-wcs="if: .first"><b>*</b></template></li></template></ul></div>`,
          () => ({ items: [{ name: "a" }, { name: "b" }, { name: "c" }], get "items.*.first"() { return (this as any).$1 === 0; } }), { adopt: "li" });
        return run(p, (r) => texts(r, "li").join(" "), [(s) => { s.items = [...s.items].reverse(); }]);
      });
      expect(result).toEqual(["a* b c", "c* b a"]);
      expect(errors).toEqual([]);
    });

    it("$1 を読む行 getter（if: .first）: 先頭への行の追加", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><ul><template data-wcs="for: items"><li>{{ .name }}<template data-wcs="if: .first"><b>*</b></template></li></template></ul></div>`,
          () => ({ items: [{ name: "a" }, { name: "b" }, { name: "c" }], get "items.*.first"() { return (this as any).$1 === 0; } }), { adopt: "li" });
        return run(p, (r) => texts(r, "li").join(" "), [(s) => { s.items = [{ name: "z" }, ...s.items]; }]);
      });
      expect(result).toEqual(["a* b c", "z* a b c"]);
      expect(errors).toEqual([]);
    });

    // router の形（`get q() { return this.query.q ?? ""; }`）を、router 無しで query を状態のキーにして写した形
    it("router の形の代わり: if: q（get q() { return this.query.q ?? \"\" }）", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><template data-wcs="if: q"><p>q=<span>{{ q }}</span></p></template></div>`,
          () => ({ query: {}, get q() { return (this as any).query.q ?? ""; } }));
        return run(p, rootText, [(s) => { s.query = { q: "hello" }; }, (s) => { s.query = {}; }]);
      });
      expect(result).toEqual(["", "q=hello", ""]);
      expect(errors).toEqual([]);
    });

    // 追加の形: サーバーが描いた枝・行の中の、getter だけが条件の if: / elseif:
    it("追加: if: a の枝の中の if: loggedIn と、行の中の elseif: の行 getter", async () => {
      const { result, errors } = await capture(async () => {
        const p = await load(`<div id="root"><template data-wcs="if: a"><section>
  <template data-wcs="if: loggedIn"><p>welcome</p></template><template data-wcs="else:"><p>login</p></template>
  <ul><template data-wcs="for: items"><li>{{ .n }}<template data-wcs="if: .big"><b>B</b></template><template data-wcs="elseif: .small"><b>S</b></template></li></template></ul>
</section></template></div>`, () => ({
          a: true, user: null, items: [{ n: 1 }, { n: 5 }],
          get loggedIn() { return (this as any).user !== null; },
          get "items.*.big"() { return (this as any)["items.*.n"] > 3; },
          get "items.*.small"() { return (this as any)["items.*.n"] < 0; },
        }), { adopt: "section" });
        return run(p, rootText, [
          (s) => { s.user = {}; },
          (s) => { s["items.0.n"] = -1; },
          (s) => { s["items.1.n"] = 2; },
          (s) => { s["items.0.n"] = 7; },
        ]);
      });
      expect(result).toEqual(["login15B", "welcome15B", "welcome-1S5B", "welcome-1S2", "welcome7B2"]);
      expect(errors).toEqual([]);
    });

    it("対照: 同じ getter を {{ loggedIn }} でも読むページ", async () => {
      const p = await load(`<div id="root"><i>{{ loggedIn }}</i>
  <template data-wcs="if: loggedIn"><p>welcome</p></template>
  <template data-wcs="else:"><p>please log in</p></template>
</div>`, () => ({ user: null, get loggedIn() { return (this as any).user !== null; } }), { adopt: "p" });
      expect(await run(p, rootText, [(s) => { s.user = { name: "a" }; }, (s) => { s.user = null; }]))
        .toEqual(["falsepleaselogin", "truewelcome", "falsepleaselogin"]);
    });

    it("対照: getter を回す for: shown", async () => {
      const p = await load(`<div id="root"><ul><template data-wcs="for: shown"><li>{{ .n }}</li></template></ul></div>`,
        () => ({ items: [{ n: 1 }, { n: 5 }], get shown() { return (this as any).items.filter((x: any) => x.n > 2); } }), { adopt: "li" });
      // the getter reads x.n on the array it got back (untracked — 3.3 README "Only path reads through `this` are tracked"): replace the array
      expect(await run(p, rootText, [(s) => { s.items = [{ n: 9 }, { n: 5 }]; }])).toEqual(["5", "95"]);
    });
  });
});

// ---------------------------------------------------------------- 追加（Issue とは別）

describe("追加: Light DOM の bind-component の子の if: の枝・for: の行のサーバーのノードを、ハイドレーションで引き取る", () => {
  let kid = "";
  beforeAll(() => {
    kid = `issue2-kid-${seq++}`;
    customElements.define(kid, class extends HTMLElement { state = {}; });
  });

  it("子の if: の枝（ページの直下の子）", async () => {
    const p = await ssrLoad(`<div id="root"><${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template></${kid}></div>`,
      () => ({ x: true }), { adopt: "i" });
    expect(flat(p.root.querySelector("#root"))).toBe("X");
  });

  it("子の for: の行（ページの直下の子）", async () => {
    const p = await ssrLoad(`<div id="root"><${kid} data-wcs="state.items: items"><wcs-state bind-component="state"></wcs-state><ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul></${kid}></div>`,
      () => ({ items: [{ id: "a" }, { id: "b" }] }), { adopt: "li" });
    expect(flat(p.root.querySelector("#root"))).toBe("ab");
  });

  it("F33: 引き取った子の枝・行が、その後の書き込みに追従する", async () => {
    const p = await ssrLoad(`<div id="root"><${kid} data-wcs="state.x: x; state.items: items"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template><template data-wcs="else:"><i>N</i></template><ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul></${kid}></div>`,
      () => ({ x: true, items: [{ id: "a" }, { id: "b" }] }), { adopt: "li" });
    await p.write((s) => { s.x = false; s.items = [...s.items, { id: "c" }]; s["items.0.id"] = "A"; });
    expect(flat(p.root.querySelector("#root"))).toBe("NAbc");
    await p.write((s) => { s.x = true; s.items = s.items.slice(1); });
    expect(flat(p.root.querySelector("#root"))).toBe("Xbc");
  });

  it("F33: ページの for: の行の中の子（行ごとに引き取る）", async () => {
    const p = await ssrLoad(`<div id="root"><template data-wcs="for: groups"><section>{{ .t }}:<${kid} data-wcs="state.items: .list"><wcs-state bind-component="state"></wcs-state><template data-wcs="for: items"><b>{{ . }}</b></template></${kid}></section></template></div>`,
      () => ({ groups: [{ t: "g", list: [1, 2] }, { t: "h", list: [3] }] }), { adopt: "b" });
    expect(texts(p.root, "section")).toEqual(["g:12", "h:3"]);
    await p.write((s) => { s["groups.1.list"] = [3, 4]; s.groups = [s.groups[1], s.groups[0]]; });
    expect(texts(p.root, "section")).toEqual(["h:34", "g:12"]);
  });

  it("F33: 子の中の孫（Light DOM の子の中の Light DOM の子）も引き取る", async () => {
    const grand = `issue2-grand-${seq++}`;
    customElements.define(grand, class extends HTMLElement { state = {}; });
    const p = await ssrLoad(`<div id="root"><${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state><${grand} data-wcs="state.y: x"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: y"><em>Y</em></template></${grand}></${kid}></div>`,
      () => ({ x: true }), { adopt: "em" });
    expect(flat(p.root.querySelector("#root"))).toBe("Y");
    await p.write((s) => { s.x = false; });
    expect(flat(p.root.querySelector("#root"))).toBe("");
  });

  it("対照: ページの if: の枝の中の子の、ページが描いた部分（div.a）は引き取る", async () => {
    const p = await ssrLoad(`<div id="root"><template data-wcs="if: a"><div class="a">A <${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template></${kid}></div></template></div>`,
      () => ({ a: true, x: true }), { adopt: ".a" });
    expect(flat(p.root.querySelector("#root"))).toBe("AX");
  });
});

describe("追加: Light DOM の bind-component の子のクラスがハイドレーションの後に定義される（autoloader の遅延読み込み）", () => {
  let kid = "";
  beforeAll(() => {
    kid = `issue2-kid-${seq++}`;
    customElements.define(kid, class extends HTMLElement { state = {}; });
  });

  /** Renders with `kid` on the server; the client sees a tag not defined yet, defined after the hydration. */
  async function lazy(html: string, state: () => Record<string, any>) {
    const out = await serverRender(`<wcs-state enable-ssr></wcs-state>${html}`, state());
    const late = `issue2-late-${seq++}`;
    const p = await hydrate(out.replaceAll(kid, late), state());
    const before = flat(p.root.querySelector("#root"));
    customElements.define(late, class extends HTMLElement { state = {}; });
    await flush();
    await flush();
    await flush();
    return { ...p, before, after: flat(p.root.querySelector("#root")) };
  }

  it("子の {{ x }}: 定義までサーバーの値のまま（生の {{ x }} に戻らない）", async () => {
    const r = await lazy(`<div id="root"><${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state><b>{{ x }}</b></${kid}></div>`, () => ({ x: "one" }));
    expect({ before: r.before, after: r.after }).toEqual({ before: "one", after: "one" });
  });

  it("子の if: の枝: 定義までサーバーの枝が残る", async () => {
    const r = await lazy(`<div id="root"><${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state><template data-wcs="if: x"><i>X</i></template></${kid}></div>`, () => ({ x: true }));
    expect({ before: r.before, after: r.after }).toEqual({ before: "X", after: "X" });
  });

  it("子の for: の行: 定義までサーバーの行が残る", async () => {
    const r = await lazy(`<div id="root"><${kid} data-wcs="state.items: items"><wcs-state bind-component="state"></wcs-state><ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul></${kid}></div>`, () => ({ items: [{ id: "a" }, { id: "b" }] }));
    expect({ before: r.before, after: r.after }).toEqual({ before: "ab", after: "ab" });
  });

  it("F33: 定義の後は、子の {{ }}・if:・for: が書き込みに追従する（サーバーのノードを引き取っている）", async () => {
    const r = await lazy(`<div id="root"><${kid} data-wcs="state.x: x; state.items: items"><wcs-state bind-component="state"></wcs-state><b>{{ x }}</b><template data-wcs="if: x"><i>!</i></template><ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul></${kid}></div>`,
      () => ({ x: "one", items: [{ id: "a" }] }));
    expect(r.after).toBe("one!a");
    const li = r.root.querySelector("li")!;
    await r.write((s) => { s.x = ""; s.items = [...s.items, { id: "b" }]; });
    expect([flat(r.root.querySelector("#root")), r.root.querySelector("li") === li]).toEqual(["ab", true]);
  });

  it("対照: 子の属性の束縛（textContent: x）はサーバーの値のまま", async () => {
    const r = await lazy(`<div id="root"><${kid} data-wcs="state.x: x"><wcs-state bind-component="state"></wcs-state><b data-wcs="textContent: x"></b></${kid}></div>`, () => ({ x: "one" }));
    expect({ before: r.before, after: r.after }).toEqual({ before: "one", after: "one" });
  });
});
