import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, diagnostics, getBindingsReady, installFeatures } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

async function host(html: string, init?: (el: any) => void) {
  const h = document.createElement(`element-test-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  init?.(el);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  return { h, root, el };
}

describe("<wcs-state> の状態の読み込みと公開 API", () => {
  it("json 属性から状態を読む", async () => {
    const { root } = await host(`<wcs-state json='{"msg":"hi"}'></wcs-state><p>{{ msg }}</p>`);
    expect(root.querySelector("p")!.textContent).toBe("hi");
  });

  it("接続前の setInitialState を使う", async () => {
    const { root } = await host(`<wcs-state></wcs-state><p>{{ n }}</p>`, (el) => el.setInitialState({ n: 3 }));
    expect(root.querySelector("p")!.textContent).toBe("3");
  });

  it("接続後に setInitialState を待つ", async () => {
    const h = document.createElement(`element-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ n }}</p>`;
    document.body.appendChild(h);
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ n: 7 });
    await el.connectedCallbackPromise;
    expect(root.querySelector("p")!.textContent).toBe("7");
  });

  it("createState('readonly') の中の書き込みは投げる", async () => {
    const { el } = await host(`<wcs-state json='{"n":1}'></wcs-state>`);
    expect(() => el.createState("readonly", (s: any) => { s.n = 2; })).toThrow("This state is readonly.");
    el.createState("writable", (s: any) => { s.n = 2; });
    el.createState("readonly", (s: any) => expect(s.n).toBe(2));
  });

  it("createStateAsync は await をまたげ、readonly は await の後も（メソッド経由の書き込みも）投げる", async () => {
    const { el, root } = await host(`<wcs-state></wcs-state><p>{{ n }}</p>`, (e) => e.setInitialState({ n: 1, bump(this: any) { this.n++; } }));
    await el.createStateAsync("writable", async (s: any) => {
      await flush();
      s.n = 5;
    });
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("5");
    await expect(el.createStateAsync("readonly", async (s: any) => {
      await flush();
      expect(s.n).toBe(5);
      s.bump();
    })).rejects.toThrow("This state is readonly.");
    // the readonly view is not global: an ordinary write during it still lands
    let release!: () => void;
    const reading = el.createStateAsync("readonly", () => new Promise<void>((r) => { release = r; }));
    el.createState("writable", (s: any) => { s.n = 6; });
    release();
    await reading;
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("6");
  });

  it("initializePromise は $connectedCallback の完了を待たずに解決し、初期化の失敗でも解決する（失敗は connectedCallbackPromise）", async () => {
    const order: string[] = [];
    const h = document.createElement(`element-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><p>{{ n }}</p>`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ n: 1, async $connectedCallback() { order.push("connected:start"); await flush(); order.push("connected:end"); } });
    void el.initializePromise.then(() => order.push(`initialized:${root.querySelector("p")!.textContent}`));
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    expect(order).toEqual(["connected:start", "initialized:1", "connected:end"]);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = document.createElement(`element-test-${seq++}`);
    const badRoot = bad.attachShadow({ mode: "open" });
    badRoot.innerHTML = `<wcs-state></wcs-state>`;
    const badEl = badRoot.querySelector("wcs-state") as any;
    badEl.setInitialState({ $scan: {} });
    document.body.appendChild(bad);
    await expect(badEl.initializePromise).resolves.toBeUndefined();
    await expect(badEl.connectedCallbackPromise).rejects.toThrow("$scan");
    error.mockRestore();
  });

  it("$disconnectedCallback は外したときに同期で呼ばれ、再接続で $connectedCallback が再び呼ばれる", async () => {
    const calls: string[] = [];
    const { h } = await host(`<wcs-state></wcs-state>`, (el) => el.setInitialState({
      $connectedCallback() { calls.push("connected"); },
      $disconnectedCallback() { calls.push("disconnected"); },
    }));
    h.remove();
    expect(calls).toEqual(["connected", "disconnected"]);
    document.body.appendChild(h);
    expect(calls).toEqual(["connected", "disconnected", "connected"]);
  });

  it("$renderedCallback は反映したバインディングのパスと行の添字を受け取る", async () => {
    const seen: [string[], Record<string, number[][]>][] = [];
    const { el } = await host(
      `<wcs-state></wcs-state><p>{{ title }}</p><ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`,
      (e) => e.setInitialState({
        title: "t", items: [{ v: 1 }, { v: 2 }], other: 0,
        $renderedCallback(paths: string[], idx: Record<string, number[][]>) { seen.push([paths, idx]); },
      }),
    );
    el.createState("writable", (s: any) => { s["items.1.v"] = 20; s.other = 1; });
    await flush();
    expect(seen).toEqual([[["items.*.v"], { "items.*.v": [[1]] }]]);
    el.createState("writable", (s: any) => { s.title = "u"; });
    await flush();
    expect(seen[1]).toEqual([["title"], {}]);
  });

  it("$errorCallback が無ければ失敗は console.error に出て、他のバインディングは反映される", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { root } = await host(`<wcs-state></wcs-state><p class="a">{{ bad }}</p><p class="b">{{ ok }}</p>`, (el) =>
      el.setInitialState({ ok: "ok", get bad() { throw new Error("boom"); } }));
    expect(root.querySelector(".b")!.textContent).toBe("ok");
    expect(err).toHaveBeenCalledWith(expect.stringContaining('binding "text: bad" failed to apply'), expect.any(Error));
    err.mockRestore();
  });
});

describe("後付けの要素（wcs/feature-not-installed）", () => {
  it.each([["mount", `<wcs-state mount="i18n" json='{"a":1}'></wcs-state>`], ["enable-ssr", `<wcs-state enable-ssr json='{"a":1}'></wcs-state>`]])(
    "%s 属性の <wcs-state> は、入れる入口を案内して初期化に失敗する",
    async (_name, html) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const h = document.createElement(`element-test-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = html;
      document.body.appendChild(h);
      const el = root.querySelector("wcs-state") as any;
      await expect(el.connectedCallbackPromise).rejects.toThrow("[wcs/feature-not-installed]");
      error.mockRestore();
    },
  );

  it("getter のリストは依存の変化で同期し直し、getter の失敗はその for の失敗として報告する", async () => {
    const errors: string[] = [];
    const { root, el } = await host(`<wcs-state></wcs-state><ul><template data-wcs="for: view"><li>{{ . }}</li></template></ul>`, (e) => e.setInitialState({
      mode: "ok", src: ["a"],
      get view() { if (this.mode === "bad") throw new Error("boom"); return this.src; },
      $errorCallback(error: Error, info: any) { errors.push(`${info.bindingType}: ${info.path} ${error.message}`); },
    }));
    const lis = () => Array.from(root.querySelectorAll("li")).map((li) => li.textContent);
    el.createState("writable", (s: any) => { s.src = ["a", "b"]; });
    await flush();
    expect(lis()).toEqual(["a", "b"]);
    el.createState("writable", (s: any) => { s.mode = "bad"; });
    await flush();
    expect(errors).toEqual(["for: view boom"]);
    expect(lis()).toEqual(["a", "b"]);
    el.createState("writable", (s: any) => { s.mode = "ok"; s.src = ["c"]; });
    await flush();
    expect(lis()).toEqual(["c"]);
  });

  it("Trusted Types に止められた HTML の書き込みは、診断が直し方を 1 回だけ出す", async () => {
    installFeatures([diagnostics]);
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!;
    Object.defineProperty(Element.prototype, "innerHTML", {
      configurable: true,
      get: desc.get,
      set(this: Element, v: unknown) {
        if (typeof v === "string" && this.id.startsWith("tt")) throw new TypeError("This document requires 'TrustedHTML' assignment.");
        desc.set!.call(this, v);
      },
    });
    (globalThis as any).trustedTypes = {};
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { root } = await host(`<wcs-state></wcs-state><div id="tt1" data-wcs="innerHTML: a"></div><div id="tt2" data-wcs="innerHTML: a"></div><p>{{ b }}</p>`, (e) => e.setInitialState({ a: "<b>x</b>", b: "ok" }));
      const reports = err.mock.calls.filter((c) => String(c[0]).includes('Writing to "innerHTML" was blocked by Trusted Types'));
      expect(reports).toHaveLength(1);
      expect(String(reports[0][0])).toContain('Symbol.for("wcstack.trustedTypes.policy")');
      expect(String(reports[0][0])).toContain("No sanitizing policy is installed");
      expect(root.querySelector("p")!.textContent).toBe("ok");
    } finally {
      Object.defineProperty(Element.prototype, "innerHTML", desc);
      delete (globalThis as any).trustedTypes;
      err.mockRestore();
    }
  });

  it("for のリストが状態に無ければその失敗として報告し、後から書けば描画する", async () => {
    const errors: string[] = [];
    const { root, el } = await host(`<wcs-state></wcs-state><ul><template data-wcs="for: itemz"><li>{{ . }}</li></template></ul>`, (e) => e.setInitialState({
      $errorCallback(error: Error, info: any) { errors.push(`${info.bindingType}: ${info.path} ${error.message}`); },
    }));
    await flush();
    expect(errors).toEqual([expect.stringMatching(/^for: itemz .*\[wcs\/binding-path-missing\]/)]);
    el.createState("writable", (s: any) => { s.itemz = ["a", "b"]; });
    await flush();
    expect(Array.from(root.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["a", "b"]);
  });
});
