/**
 * The DevTools add-on over the hook protocol v2 (cycle 5): the events the add-ons notice
 * (`state:watch-fired` / `state:watch-error` / `state:watch-chain-limit` from temporal,
 * `state:path-unresolved` from diagnostics, in 3.x's payload shapes — I3), and a DevTools that
 * detaches and attaches again (I7). (A file of its own: it installs devtools, which registers a
 * source on the page's hook registry.)
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, devtools, diagnostics, getBindingsReady, installFeatures, temporal } from "../src/index";
import { hooks } from "../src/hooks";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([diagnostics, temporal, devtools]);
  bootstrapState();
});

const registry = () => (globalThis as any).__WCSTACK_DEVTOOLS_HOOK__;

async function host(html: string, state: Record<string, any>) {
  const h = document.createElement(`quality-devtools-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  return { h, root, el };
}

/** Attaches a listener; the events it got, and how to detach it. */
function listen(): { events: any[]; off: () => void } {
  const events: any[] = [];
  const off = registry()["addListener"]({ onEvent: (_id: string, e: any) => events.push(e) });
  return { events, off };
}

describe("add-on が気づいたことを DevTools に送る（I3）", () => {
  it("DevTools が付いていない間は、通知の受け口が空（ペイロードを作らない）", () => {
    expect(hooks.noticed ?? null).toBe(null);
  });

  it("$watch の発火と、ハンドラ・値の評価の失敗を、3.x の形で送る（どれにも発火元の stateElement を付ける）", async () => {
    const { events, off } = listen();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(typeof hooks.noticed).toBe("function");
      const { el } = await host(`<p>{{ count }}</p>`, {
        count: 0,
        get bad() { if ((this as any).count > 1) throw new Error("bad getter"); return 0; },
        $watch: {
          count(cur: number) { if (cur === 3) throw new Error("bad handler"); },
          bad() {},
        },
      });
      el.createState("writable", (s: any) => { s.count = 1; });
      await flush();
      el.createState("writable", (s: any) => { s.count = 3; });
      await flush();
      expect(events.filter((e) => e.type === "state:watch-fired")).toEqual([
        { "type": "state:watch-fired", "path": "count", "stateElement": el },
        { "type": "state:watch-fired", "path": "bad", "stateElement": el },
        { "type": "state:watch-fired", "path": "count", "stateElement": el },
      ]);
      const errors = events.filter((e) => e.type === "state:watch-error").map((e) => [e.phase, e.path, (e.error as Error).message]);
      expect(errors).toEqual([["handler", "count", "bad handler"], ["evaluate", "bad", "bad getter"]]);
    } finally {
      spy.mockRestore();
      off();
    }
  });

  it("活性化のときに watch した getter が投げても、接続は続き、ほかの $watch は動き、phase \"prime\" で送る（R6）", async () => {
    const { events, off } = listen();
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a[0]); });
    try {
      let fired = 0;
      const h = document.createElement(`quality-devtools-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><p>{{ count }}</p><ul><template data-wcs="for: rows"><li>{{ .n }}</li></template></ul>`;
      const el = root.querySelector("wcs-state") as any;
      el.setInitialState({
        count: 0, user: null, rows: [{ n: 1 }, { n: 2 }],
        get userName() { return (this as any).user.name; },
        get "rows.*.label"() { if ((this as any)["rows.*.n"] === 2) throw new Error("row 2"); return "ok"; },
        $watch: { count() { fired++; }, userName() {}, "rows.*.label"() {} },
      });
      document.body.appendChild(h);
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
      el.createState("writable", (s: any) => { s.count = 1; });
      await flush();
      expect(fired).toBe(1);
      expect(events.some((e) => e.type === "state:element-registered" && e.element === el)).toBe(true);
      const prime = events.filter((e) => e.type === "state:watch-error").map((e) => [e.phase, e.path, e.stateElement === el]);
      expect(prime).toEqual([["prime", "userName", true], ["prime", "rows.*.label", true]]);
      expect(errors).toEqual(['[@wcstack/state] $watch initial evaluation of "userName" threw.', '[@wcstack/state] $watch initial evaluation of "rows.*.label" threw.']);
    } finally {
      spy.mockRestore();
      off();
    }
  });

  it("行の watch が読む一覧が getter で、活性化のときに投げても、接続は続き、ほかの $watch は動く（R8）", async () => {
    const { events, off } = listen();
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a[0]); });
    try {
      let fired = 0;
      const h = document.createElement(`quality-devtools-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><p>{{ count }}</p>`;
      const el = root.querySelector("wcs-state") as any;
      el.setInitialState({
        count: 0, user: null,
        get visible() { return (this as any).user.items; },
        $watch: { "visible.*.name"() {}, count() { fired++; } },
      });
      document.body.appendChild(h);
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
      el.createState("writable", (s: any) => { s.count = 1; });
      await flush();
      expect(fired).toBe(1);
      expect(events.some((e) => e.type === "state:element-registered" && e.element === el)).toBe(true);
      expect(events.filter((e) => e.type === "state:watch-error").map((e) => [e.phase, e.path])).toEqual([["prime", "visible.*.name"]]);
      expect(errors).toEqual(['[@wcstack/state] $watch initial evaluation of "visible.*.name" threw.']);
    } finally {
      spy.mockRestore();
      off();
    }
  });

  it("$watch の書き込みの連鎖を切ったことを、上限と watch のパスで送る", async () => {
    const { events, off } = listen();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { el } = await host(`<p>{{ n }}</p>`, { n: 0, $watch: { n(this: any, cur: number) { this.n = cur + 1; } } });
      el.createState("writable", (s: any) => { s.n = 1; });
      for (let i = 0; i < 5; i++) await flush();
      const cut = events.filter((e) => e.type === "state:watch-chain-limit");
      expect(cut).toEqual([{ "type": "state:watch-chain-limit", "maxDepth": 32, "paths": ["n"], "stateElement": el }]);
    } finally {
      spy.mockRestore();
      off();
    }
  });

  it("解決しないパス（束縛・$watch）を、source と欠けた段で送る（diagnostics）", async () => {
    const { events, off } = listen();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await host(`<p>{{ user.nmae }}</p>`, { user: { name: "a" }, $watch: { "user.agee"() {} } });
      await flush();
      const unresolved = events.filter((e) => e.type === "state:path-unresolved").map((e) => [e.source, e.path, e.missingSegment]).sort();
      expect(unresolved).toEqual([["binding", "user.nmae", "nmae"], ["watch", "user.agee", "agee"]]);
    } finally {
      spy.mockRestore();
      off();
    }
  });

  it("DevTools を外すと、通知の受け口はまた空になる", () => {
    expect(hooks.noticed ?? null).toBe(null);
  });
});

describe("DevTools の取り外しと付け直し（I7）", () => {
  it("付け直した DevTools にも、残っている束縛の binding-added が届く", async () => {
    const { root } = await host(`<p data-wcs="textContent: a"></p><p data-wcs="textContent: b"></p>`, { a: 1, b: 2 });
    const added = (events: any[]) => events
      .filter((e) => e.type === "state:binding-added" && e.binding.node.getRootNode() === root)
      .map((e) => e.binding.statePathName).sort();
    const first = listen();
    await flush();
    expect(added(first.events)).toEqual(["a", "b"]);
    first.off();
    const second = listen();
    await flush();
    expect(added(second.events)).toEqual(["a", "b"]);
    second.off();
  });
});
