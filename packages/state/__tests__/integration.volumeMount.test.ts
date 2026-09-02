/**
 * ボリューム（`<wcs-state mount="path">` の接ぎ木）— docs/state-mount-design.md §4-2 / D22。
 * e2e/fixtures/mount-volume.html の V1〜V7 を happy-dom で鏡写しにする
 * （state ソースは setInitialState API — getter を含むオブジェクトを渡すため）。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

function i18nVolume(): Record<string, any> {
  return {
    lang: "en",
    dict: {
      en: { title: "Hello", items: "items" },
      ja: { title: "こんにちは", items: "件" },
    },
    connected: false,
    get t() { return this.dict[this.lang]; },
    $connectedCallback() { this.connected = true; },
  };
}

interface IMountOptions {
  volumeFirst?: boolean;
  rootJson?: string;
  mountPath?: string;
}

async function mountPage(options: IMountOptions = {}) {
  const { volumeFirst = true, mountPath = "i18n" } = options;
  const host = document.createElement(uniqueTag("vol-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  const volumeTagHtml = `<wcs-state mount="${mountPath}"></wcs-state>`;
  const rootHtml =
    `<wcs-state json='${options.rootJson ?? '{"count":1}'}'></wcs-state>` +
    `<h1 id="title" data-wcs="textContent: i18n.t.title"></h1>` +
    `<p id="lang" data-wcs="textContent: i18n.lang"></p>`;
  shadowRoot.innerHTML = volumeFirst ? volumeTagHtml + rootHtml : rootHtml + volumeTagHtml;
  document.body.appendChild(host);

  const volumeElement = shadowRoot.querySelector(`wcs-state[mount]`) as State;
  const rootElement = shadowRoot.querySelector(`wcs-state:not([mount])`) as State;
  // ボリュームはソース属性を持たない → setInitialState（API）で渡す
  volumeElement.setInitialState(i18nVolume());
  await rootElement.connectedCallbackPromise;
  await volumeElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  await flush();

  const text = (selector: string) => (shadowRoot.querySelector(selector) as HTMLElement).textContent;
  return { host, shadowRoot, rootElement, volumeElement, text };
}

describe("volume: 接ぎ木（V1/V2/V5）", () => {
  it("ルートより先に置いたボリュームが i18n.* として読めること", async () => {
    const { host, text } = await mountPage({ volumeFirst: true });
    expect(text("#title")).toBe("Hello");
    expect(text("#lang")).toBe("en");
    host.remove();
  });

  it("ルートより後に置いても同じであること（ロード順に依存しない）", async () => {
    const { host, text } = await mountPage({ volumeFirst: false });
    expect(text("#title")).toBe("Hello");
    expect(text("#lang")).toBe("en");
    host.remove();
  });

  it("ボリュームの getter がマウント配下に依存し、書き込みで再評価されること", async () => {
    const { host, rootElement, text } = await mountPage();
    rootElement.createState("writable", (s: any) => {
      s["i18n.lang"] = "ja";
    });
    await flush();
    await flush();
    expect(text("#title")).toBe("こんにちは");
    expect(text("#lang")).toBe("ja");
    host.remove();
  });
});

describe("volume: ルートの getter からの読み（V3）", () => {
  it("ルートの getter が i18n.t.items に依存し、i18n.lang の変更で再評価されること", async () => {
    const host = document.createElement(uniqueTag("vol-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state mount="i18n"></wcs-state>` +
      `<wcs-state></wcs-state>` +
      `<p id="label" data-wcs="textContent: label"></p>`;
    document.body.appendChild(host);
    const volumeElement = shadowRoot.querySelector(`wcs-state[mount]`) as State;
    const rootElement = shadowRoot.querySelector(`wcs-state:not([mount])`) as State;
    volumeElement.setInitialState(i18nVolume());
    rootElement.setInitialState({
      count: 1,
      get label() { return `${this.count} ${(this as any)["i18n.t.items"]}`; },
    });
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    await flush();

    const label = () => (shadowRoot.querySelector("#label") as HTMLElement).textContent;
    expect(label()).toBe("1 items");

    rootElement.createState("writable", (s: any) => { s.count = 2; });
    await flush();
    expect(label()).toBe("2 items");

    rootElement.createState("writable", (s: any) => { s["i18n.lang"] = "ja"; });
    await flush();
    await flush();
    expect(label()).toBe("2 件");

    host.remove();
  });
});

describe("volume: $connectedCallback（V7）と chroot 書き込み", () => {
  it("$connectedCallback が chroot で走り、this への書き込みがツリーに載ること", async () => {
    const { host, rootElement } = await mountPage();
    let connected: unknown;
    rootElement.createState("readonly", (s: any) => {
      connected = s["i18n.connected"];
    });
    expect(connected).toBe(true);
    host.remove();
  });
});

describe("volume: 予約と衝突（D22）", () => {
  it("ルートデータに同名キーがあれば接ぎ木時に throw（隔離されて console.error）すること", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { host } = await mountPage({ rootJson: '{"count":1,"i18n":{"x":1}}' });
      await flush();
      const collided = error.mock.calls.some((c) => c.some((a) => String(a).includes("collides")));
      expect(collided).toBe(true);
      host.remove();
    } finally {
      error.mockRestore();
    }
  });

  it("mount にワイルドカードや予約文字は使えないこと", async () => {
    for (const bad of ["a.*", "$x", "a.#m", "a@b"]) {
      const el = document.createElement("wcs-state") as State;
      el.setAttribute("mount", bad);
      const holder = document.createElement("div");
      holder.appendChild(el);
      document.body.appendChild(holder);
      await expect((el as any)._initializeVolume?.() ?? Promise.reject(new Error("no fn"))).rejects.toThrow();
      holder.remove();
    }
  });

  it("深いマウント（a.b）は中間の {} を作ること", async () => {
    const host = document.createElement(uniqueTag("vol-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state mount="app.i18n"></wcs-state>` +
      `<wcs-state json='{"count":1}'></wcs-state>` +
      `<p id="t" data-wcs="textContent: app.i18n.t.title"></p>`;
    document.body.appendChild(host);
    const volumeElement = shadowRoot.querySelector(`wcs-state[mount]`) as State;
    const rootElement = shadowRoot.querySelector(`wcs-state:not([mount])`) as State;
    volumeElement.setInitialState(i18nVolume());
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    await flush();

    expect((shadowRoot.querySelector("#t") as HTMLElement).textContent).toBe("Hello");
    host.remove();
  });
});

describe("volume: 検査と chroot の面（カバレッジ確定）", () => {
  it("mount と bind-component / name の併記は throw すること", async () => {
    for (const attrs of [{ "bind-component": "state" }, { name: "x" }] as const) {
      const el = document.createElement("wcs-state") as State;
      el.setAttribute("mount", "vol");
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      const holder = document.createElement("div");
      holder.appendChild(el);
      document.body.appendChild(holder);
      await expect((el as any)._initializeVolume()).rejects.toThrow(/cannot be combined|replaces "name"/);
      holder.remove();
    }
  });

  it("同じスロットの二重予約と、空パス・空セグメントは throw すること", async () => {
    const { reserveVolumeSlot, validateVolumeMountPath, isPathUnderReservedVolume } = await import("../src/webComponent/volume");
    const rootNode = document.createDocumentFragment();
    reserveVolumeSlot(rootNode, "dup");
    expect(() => reserveVolumeSlot(rootNode, "dup")).toThrow(/already mounted/);
    expect(() => validateVolumeMountPath("")).toThrow(/non-empty/);
    expect(() => validateVolumeMountPath("a..b")).toThrow(/empty segment/);
    // 予約判定: 配下・祖先・無関係
    expect(isPathUnderReservedVolume(rootNode, "dup.deep.key")).toBe(true);
    expect(isPathUnderReservedVolume(rootNode, "du")).toBe(false);
    expect(isPathUnderReservedVolume(rootNode, "other")).toBe(false);
    expect(isPathUnderReservedVolume(null, "dup")).toBe(false);
    expect(isPathUnderReservedVolume(document.createDocumentFragment(), "dup")).toBe(false);
  });

  it("予約下（ロード前）の読みは 1 セグメントも深いパスも undefined で騒がないこと", async () => {
    const { reserveVolumeSlot } = await import("../src/webComponent/volume");
    const host = document.createElement(uniqueTag("vol-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state json='{"count":1}'></wcs-state>`;
    document.body.appendChild(host);
    const rootElement = shadowRoot.querySelector("wcs-state") as State;
    await rootElement.connectedCallbackPromise;
    reserveVolumeSlot(shadowRoot, "pending");

    let single: unknown = "sentinel";
    let deep: unknown = "sentinel";
    rootElement.createState("readonly", (s: any) => {
      single = s["pending"];
      deep = s["pending.t.x"];
    });
    expect(single).toBeUndefined();
    expect(deep).toBeUndefined();
    host.remove();
  });

  it("setter アクセサ・$ API・in が chroot で成立すること", async () => {
    const log: unknown[] = [];
    const host = document.createElement(uniqueTag("vol-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state mount="cfg"></wcs-state>` +
      `<wcs-state json='{"count":1}'></wcs-state>` +
      `<p id="mode" data-wcs="textContent: cfg.mode"></p>`;
    document.body.appendChild(host);
    const volumeElement = shadowRoot.querySelector(`wcs-state[mount]`) as State;
    const rootElement = shadowRoot.querySelector(`wcs-state:not([mount])`) as State;
    volumeElement.setInitialState({
      mode: "light",
      history: [] as string[],
      set modeSetter(value: string) { this.mode = value; },
      get summary() {
        // $getAll と in を chroot 越しに使う
        const seen = "mode" in (this as any) ? "M" : "-";
        const all = (this as any).$getAll("history.*", []);
        return `${seen}:${all.length}`;
      },
      $connectedCallback() {
        // chroot 書き込みと $postUpdate の翻訳（$resolve の index 書きはレンダ済み
        // リストが要るのでここでは使わない）
        (this as any).history = ["first"];
        (this as any).$postUpdate("summary");
        log.push("connected");
      },
    });
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    await flush();

    const text = (sel: string) => (shadowRoot.querySelector(sel) as HTMLElement).textContent;
    expect(text("#mode")).toBe("light");
    expect(log).toEqual(["connected"]);

    // setter アクセサ（cfg.modeSetter）への書き込みが chroot 経由で cfg.mode を書くこと
    rootElement.createState("writable", (s: any) => {
      s["cfg.modeSetter"] = "dark";
    });
    await flush();
    await flush();
    expect(text("#mode")).toBe("dark");

    let summary: unknown;
    rootElement.createState("readonly", (s: any) => {
      summary = s["cfg.summary"];
    });
    expect(summary).toBe("M:1"); // $connectedCallback が history を書いた

    host.remove();
  });
});

describe("volume: 端の分岐（chroot・直接接ぎ木・非同期 $connectedCallback）", () => {
  it("chroot のシンボル・then・素の $・has の各面が安全であること", async () => {
    const { graftVolume } = await import("../src/webComponent/volume");
    const seen: Record<string, unknown> = {};
    const stateStub: any = {
      $postUpdate: (p: string) => { seen.post = p; },
      $getAll: (p: string, i: unknown) => { seen.getAll = p; return []; },
      $flag: "raw-dollar",
    };
    const rootStub = {
      name: "default",
      createState: (_m: string, cb: (s: any) => void) => cb(stateStub),
      defineTreeAccessor: (path: string, desc: PropertyDescriptor) => { seen["acc:" + path] = desc; },
    } as any;
    let chrootRef: any;
    graftVolume(rootStub, "vol", {
      data: 1,
      helper() { return "method-skipped"; },
      $connectedCallback() { chrootRef = this; },
    });
    expect(seen.postWait).toBeUndefined();
    // $connectedCallback で捕まえた chroot の面を突く
    expect(chrootRef[Symbol("s")]).toBeUndefined();
    expect(chrootRef.then).toBeUndefined();
    expect(chrootRef.$flag).toBe("raw-dollar");
    chrootRef.$postUpdate("data");
    expect(seen.post).toBe("vol.data");
    chrootRef.$getAll("items.*", []);
    expect(seen.getAll).toBe("vol.items.*");
    expect(() => { chrootRef[Symbol("t")] = 1; }).not.toThrow();
    expect("anything" in chrootRef).toBe(true);
    expect("$x" in chrootRef).toBe(false);
    expect(Symbol("u") in chrootRef).toBe(false);
    // メソッドはデータに含まれない（ツリー露出は未対応）
    expect(stateStub["vol"]).toEqual({ data: 1 });
  });

  it("ルートが既に居れば queue を通らず直接接ぎ木すること・深い衝突は throw が隔離されること", async () => {
    const { graftOrQueueVolume } = await import("../src/webComponent/volume");
    const stateStub: any = { app: { i18n: { existing: true } } };
    const rootStub = {
      name: "default",
      createState: (_m: string, cb: (s: any) => void) => cb(new Proxy(stateStub, {
        get: (t, p) => (typeof p === "string" && p.includes(".") ? p.split(".").reduce((o: any, k) => o?.[k], t) : (t as any)[p]),
        set: (t, p, v) => { (t as any)[p as string] = v; return true; },
      })),
      defineTreeAccessor: () => {},
    } as any;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let grafted = false;
    try {
      graftOrQueueVolume(document.createDocumentFragment(), rootStub, "app.i18n", { x: 1 }, () => { grafted = true; });
      expect(grafted).toBe(true); // 失敗しても finish は呼ばれる（隔離）
      expect(error.mock.calls.some((c) => String(c[0]).includes("failed to graft"))).toBe(true);
    } finally {
      error.mockRestore();
    }
  });

  it("非同期の $connectedCallback の reject は console.error に隔離されること", async () => {
    const { graftVolume } = await import("../src/webComponent/volume");
    const stateStub: any = {};
    const rootStub = {
      name: "default",
      createState: (_m: string, cb: (s: any) => void) => cb(stateStub),
      defineTreeAccessor: () => {},
    } as any;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      graftVolume(rootStub, "vol2", {
        async $connectedCallback() { throw new Error("cc-boom"); },
      });
      await flush();
      expect(error.mock.calls.some((c) => String(c[0]).includes("$connectedCallback failed"))).toBe(true);
    } finally {
      error.mockRestore();
    }
  });

  it("ロードの await 中に剥がされたボリュームはスコープを触らず完了すること", async () => {
    const el = document.createElement("wcs-state") as State;
    el.setAttribute("mount", "late-vol");
    const holder = document.createElement("div");
    holder.appendChild(el); // document には繋がない（自動 connect を避けて直接呼ぶ）
    (el as any)._rootNode = holder;
    const done = (el as any)._initializeVolume();
    (el as any)._rootNode = null; // await 中に切断された体
    el.setInitialState({ a: 1 });
    await done;
    expect((el as any)._initialized).toBe(true);
  });
});

describe("volume: 残りの腕", () => {
  it("3 段の深いマウントで中間 {} が段ごとに作られ、$connectedCallback 無しでも接ぎ木されること", async () => {
    const { graftVolume, graftOrQueueVolume, drainPendingVolumes } = await import("../src/webComponent/volume");
    const raw: any = {};
    const proxyOf = (t: any) => new Proxy(t, {
      get: (o, p) => (typeof p === "string" && p.includes(".") ? p.split(".").reduce((v: any, k) => v?.[k], o) : o[p]),
      set: (o, p, v) => {
        if (typeof p === "string" && p.includes(".")) {
          const keys = p.split(".");
          const last = keys.pop()!;
          keys.reduce((v: any, k) => v[k], o)[last] = v;
        } else {
          o[p as string] = v;
        }
        return true;
      },
    });
    const rootStub = {
      name: "default",
      createState: (_m: string, cb: (s: any) => void) => cb(proxyOf(raw)),
      defineTreeAccessor: () => {},
    } as any;
    graftVolume(rootStub, "x.y.z", { leaf: 1 });
    expect(raw).toEqual({ x: { y: { z: { leaf: 1 } } } });

    // 2 本のボリュームを同じ rootNode で保留 → drain で両方接ぎ木（pending 配列の再利用腕）
    const rootNode = document.createDocumentFragment();
    let count = 0;
    graftOrQueueVolume(rootNode, null, "q1", { a: 1 }, () => { count++; });
    graftOrQueueVolume(rootNode, null, "q2", { b: 2 }, () => { count++; });
    drainPendingVolumes(rootNode, rootStub);
    await flush();
    expect(count).toBe(2);
    expect(raw.q1).toEqual({ a: 1 });
    expect(raw.q2).toEqual({ b: 2 });
  });
});

describe("volume: 宣言面（$watch / $listKeys / $updatedCallback / $disconnectedCallback）", () => {
  async function mountDeclarative(volumeState: Record<string, any>, rootJson = '{"count":1}') {
    const host = document.createElement(uniqueTag("vol-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state mount="cfg"></wcs-state>` +
      `<wcs-state json='${rootJson}'></wcs-state>` +
      `<p id="v" data-wcs="textContent: cfg.value"></p>`;
    document.body.appendChild(host);
    const volumeElement = shadowRoot.querySelector(`wcs-state[mount]`) as State;
    const rootElement = shadowRoot.querySelector(`wcs-state:not([mount])`) as State;
    volumeElement.setInitialState(volumeState);
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    await flush();
    return { host, shadowRoot, rootElement, volumeElement };
  }

  it("$watch が相対宣言で登録され、this は chroot・ワイルドカードの indexes はスコープ相対で届くこと", async () => {
    const fired: Array<[string, unknown, unknown, number[]]> = [];
    const { host, rootElement } = await mountDeclarative({
      value: "v0",
      items: [{ id: 1, name: "a" }, { id: 2, name: "b" }],
      // S13: for バインディング無しの行 watch は $listKeys のキー突合で発火する（headless）
      $listKeys: { items: "id" },
      log: "",
      $watch: {
        value(this: any, cur: unknown, prev: unknown) {
          fired.push(["value", cur, prev, []]);
          this.log = `saw:${cur}`; // chroot 書き込み → cfg.log
        },
        "items.*.name"(this: any, cur: unknown, prev: unknown, ...indexes: number[]) {
          fired.push(["items.*.name", cur, prev, indexes]);
        },
      },
    });

    rootElement.createState("writable", (s: any) => {
      s["cfg.value"] = "v1";
    });
    await flush();
    await flush();
    expect(fired.some(([p, cur, prev]) => p === "value" && cur === "v1" && prev === "v0")).toBe(true);
    let log: unknown;
    rootElement.createState("readonly", (s: any) => { log = s["cfg.log"]; });
    expect(log).toBe("saw:v1");

    // for 無しの行 watch は $listKeys のキー突合が変化行だけをバッチに載せる（S11/S13）
    rootElement.createState("writable", (s: any) => {
      s["cfg.items"] = [{ id: 1, name: "a" }, { id: 2, name: "B!" }];
    });
    await flush();
    await flush();
    expect(fired.some(([p, cur, , idx]) => p === "items.*.name" && cur === "B!" && idx.length === 1 && idx[0] === 1)).toBe(true);

    host.remove();
  });

  it("$listKeys が翻訳されてルートの表に載り、ルート側との衝突は throw すること", async () => {
    const { host, rootElement } = await mountDeclarative({
      value: "v0",
      items: [],
      $listKeys: { items: "id" },
    });
    expect(rootElement.listKeys?.get("cfg.items")).toBe("id");

    // 衝突（同じ翻訳パスをもう一度）
    expect(() => (rootElement as any).mergeVolumeListKeys(new Map([["cfg.items", "id"]])))
      .toThrow(/declared by both/);
    host.remove();
  });

  it("$updatedCallback が自分の接頭辞配下だけを相対パスで受け、this は chroot であること", async () => {
    const seen: Array<[string[], unknown]> = [];
    const { host, rootElement } = await mountDeclarative({
      value: "v0",
      $updatedCallback(this: any, paths: string[]) {
        seen.push([paths, this.value]);
      },
    });
    seen.length = 0; // 接ぎ木時の初期通知は捨てる

    rootElement.createState("writable", (s: any) => {
      s["cfg.value"] = "v1";
      s.count = 2; // マウント外 — 届かない
    });
    await flush();
    await flush();

    expect(seen.length).toBeGreaterThan(0);
    const [paths, valueSeenViaChroot] = seen[seen.length - 1];
    expect(paths).toContain("value");
    expect(paths.every((p) => !p.startsWith("cfg.") && p !== "count")).toBe(true);
    expect(valueSeenViaChroot).toBe("v1");

    host.remove();
  });

  it("$disconnectedCallback が要素の切断時に chroot で走ること（接ぎ木は残る）", async () => {
    const { host, shadowRoot, rootElement, volumeElement } = await mountDeclarative({
      value: "v0",
      closed: false,
      $disconnectedCallback(this: any) { this.closed = true; },
    });
    volumeElement.remove();
    await flush();

    let closed: unknown;
    let value: unknown;
    rootElement.createState("readonly", (s: any) => {
      closed = s["cfg.closed"];
      value = s["cfg.value"];
    });
    expect(closed).toBe(true);
    expect(value).toBe("v0"); // 接ぎ木は残る
    expect(shadowRoot.querySelector("wcs-state[mount]")).toBeNull();
    host.remove();
  });

  it("$streams の宣言は loud に落ちること（未対応）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { host } = await mountDeclarative({
        value: "v0",
        $streams: { load: {} },
      });
      await flush();
      expect(error.mock.calls.some((c) => c.some((a) => String(a).includes("$streams")))).toBe(true);
      host.remove();
    } finally {
      error.mockRestore();
    }
  });
});

describe("volume: 宣言面の端（検査・空宣言・非同期 reject・相対配送の腕）", () => {
  it("不正な $watch / $listKeys 宣言は throw し、空宣言は何もしないこと", async () => {
    const { graftVolume } = await import("../src/webComponent/volume");
    const rootStub = () => ({
      name: "default",
      createState: (_m: string, cb: (s: any) => void) => cb({}),
      defineTreeAccessor: () => {},
      setPathInfo: () => {},
      addVolumeWatchPaths: () => {},
      mergeVolumeListKeys: () => {},
      enableUpdatedCallback: () => {},
    }) as any;
    expect(() => graftVolume(rootStub(), "w1", { $watch: "bad" })).toThrow(/must be an object/);
    expect(() => graftVolume(rootStub(), "w2", { $watch: { p: 1 } })).toThrow(/must be a function/);
    expect(() => graftVolume(rootStub(), "w3", { $listKeys: 7 })).toThrow(/must be an object/);
    expect(() => graftVolume(rootStub(), "w4", { $listKeys: { "": "id" } })).toThrow(/key function/);
    expect(() => graftVolume(rootStub(), "w5", { $listKeys: { items: 1 } })).toThrow(/key function/);
    // 空宣言はどの台帳にも触らない
    expect(() => graftVolume(rootStub(), "w6", { $watch: {}, $listKeys: {} })).not.toThrow();
  });

  it("非同期の $disconnectedCallback の reject は console.error に隔離されること", async () => {
    const { callVolumeLifecycle } = await import("../src/webComponent/volume");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      callVolumeLifecycle({
        rootStateElement: { createState: (_m: string, cb: (s: any) => void) => cb({}) } as any,
        mountPath: "vol-a",
        volumeState: { async $disconnectedCallback() { throw new Error("dc-boom"); } },
      }, "$disconnectedCallback");
      await flush();
      expect(error.mock.calls.some((c) => String(c[0]).includes("$disconnectedCallback failed"))).toBe(true);
    } finally {
      error.mockRestore();
    }
  });

  it("watch のボリューム台帳は同じパスへの追記と volume computed の prime を受けること", async () => {
    const { addVolumeWatchEntries, getVolumeWatchEntries } = await import("../src/watch/watchRegistry");
    const { getPathInfo } = await import("../src/address/PathInfo");
    const el = { name: "default" } as any;
    const entry = (path: string) => ({ path, pathInfo: getPathInfo(path), handler: () => {}, order: 0 });
    addVolumeWatchEntries(el, [entry("v.a"), entry("v.a")]); // 同一呼び出し内の同パス
    addVolumeWatchEntries(el, [entry("v.a")]); // 別呼び出しの追記
    expect(getVolumeWatchEntries(el).get("v.a")).toHaveLength(3);
    expect(getVolumeWatchEntries({ name: "none" } as any).size).toBe(0);
  });

  it("State の空セットマージは何もしないこと", async () => {
    const host = document.createElement(uniqueTag("vol-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state json='{"a":1}'></wcs-state>`;
    document.body.appendChild(host);
    const el = shadowRoot.querySelector("wcs-state") as State;
    await el.connectedCallbackPromise;
    (el as any).addVolumeWatchPaths(new Set());
    (el as any).mergeVolumeListKeys(new Map());
    expect(el.watchPaths).toBeNull();
    expect(el.listKeys).toBeNull();
    host.remove();
  });

  it("$updatedCallback の相対配送: マウント外・接ぎ木自身・行 indexes・throw の各腕", async () => {
    const thrown = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: Array<[string[], Record<string, Array<number[]>>]> = [];
    const host = document.createElement(uniqueTag("vol-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state mount="cfg"></wcs-state>` +
      `<wcs-state json='{"count":1}'></wcs-state>` +
      `<i id="c" data-wcs="textContent: count"></i>` +
      `<p id="v" data-wcs="textContent: cfg.value"></p>` +
      `<ul><template data-wcs="for: cfg.items"><li data-wcs="textContent: cfg.items.*.name"></li></template></ul>`;
    document.body.appendChild(host);
    const volumeElement = shadowRoot.querySelector(`wcs-state[mount]`) as State;
    const rootElement = shadowRoot.querySelector(`wcs-state:not([mount])`) as State;
    volumeElement.setInitialState({
      value: "v0",
      items: [{ name: "a" }],
      $updatedCallback(paths: string[], indexesListByPath: Record<string, Array<number[]>>) {
        seen.push([paths, indexesListByPath]);
        throw new Error("ucb-boom"); // 隔離される
      },
    });
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    await flush();
    seen.length = 0;

    rootElement.createState("writable", (s: any) => {
      s.count = 2;                    // マウント外（相対に混ざらない）
      s["cfg.value"] = "v1";          // スカラ
      s["cfg.items.0.name"] = "A!";   // 行（indexes 付き）
    });
    await flush();
    await flush();

    expect(seen.length).toBeGreaterThan(0);
    const [paths, idx] = seen[seen.length - 1];
    expect(paths).toContain("value");
    expect(paths).toContain("items.*.name");
    expect(paths).not.toContain("count");
    expect(idx["items.*.name"]).toEqual([[0]]);
    expect(thrown.mock.calls.some((c) => String(c[0]).includes("$updatedCallback threw"))).toBe(true);

    // 接ぎ木自身（mountPath そのもの）の書き込みは相対で表せないので届かない
    seen.length = 0;
    rootElement.createState("writable", (s: any) => {
      s.cfg = { value: "v2", items: [] };
    });
    await flush();
    await flush();
    expect(seen.every(([paths2]) => paths2.every((p) => p !== "" && !p.startsWith("cfg")))).toBe(true);

    host.remove();
    thrown.mockRestore();
  });

  it("volume の computed 宣言（getter を watch）が prime され、依存で発火すること", async () => {
    const fired: unknown[] = [];
    const host = document.createElement(uniqueTag("vol-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state mount="cfg"></wcs-state>` +
      `<wcs-state json='{"count":1}'></wcs-state>`;
    document.body.appendChild(host);
    const volumeElement = shadowRoot.querySelector(`wcs-state[mount]`) as State;
    const rootElement = shadowRoot.querySelector(`wcs-state:not([mount])`) as State;
    volumeElement.setInitialState({
      base: 2,
      get doubled() { return (this as any).base * 2; },
      $watch: {
        doubled(cur: unknown, prev: unknown) { fired.push([cur, prev]); },
      },
    });
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    await flush();

    rootElement.createState("writable", (s: any) => {
      s["cfg.base"] = 5;
    });
    await flush();
    await flush();
    expect(fired.some(([cur, prev]) => cur === 10 && prev === 4)).toBe(true);

    host.remove();
  });
});

describe("volume: 複合（2 ボリューム・ルート watch 併存・他 state 混在バッチ）", () => {
  it("残りの配送腕が全て正しく振る舞うこと", async () => {
    const events: string[] = [];
    const host = document.createElement(uniqueTag("vol-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state mount="cfgA"></wcs-state>` +
      `<wcs-state mount="cfgB"></wcs-state>` +
      `<wcs-state></wcs-state>` +
      `<b id="whole" data-wcs="textContent: cfgA"></b>` +
      `<p id="va" data-wcs="textContent: cfgA.value"></p>` +
      ``;
    document.body.appendChild(host);
    const volumeA = shadowRoot.querySelector(`wcs-state[mount="cfgA"]`) as State;
    const volumeB = shadowRoot.querySelector(`wcs-state[mount="cfgB"]`) as State;
    const rootElement = shadowRoot.querySelector(`wcs-state:not([mount]):not([name])`) as State;
    volumeA.setInitialState({
      value: "a0",
      $watch: { value(cur: unknown) { events.push(`A-watch:${cur}`); } },
      $updatedCallback(paths: string[]) { events.push(`A-ucb:${paths.join("+")}`); },
    });
    volumeB.setInitialState({
      value: "b0",
      $updatedCallback(paths: string[]) { events.push(`B-ucb:${paths.join("+")}`); },
    });
    rootElement.setInitialState({
      count: 1,
      $watch: { "cfgA.value"(cur: unknown) { events.push(`root-watch:${cur}`); } },
    });
    await rootElement.connectedCallbackPromise;
    await volumeA.connectedCallbackPromise;
    await volumeB.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    await flush();
    events.length = 0;

    // 同一バッチ: cfgA 配下だけ（他 state の混在は名前撤去で消滅）
    rootElement.createState("writable", (s: any) => {
      s["cfgA.value"] = "a1";
    });
    await flush();
    await flush();

    // ルートの watch とボリューム A の watch の両方が発火（同一翻訳パスの併存）
    expect(events).toContain("root-watch:a1");
    expect(events).toContain("A-watch:a1");
    // A の $updatedCallback は相対 value を受け、B のは呼ばれない（size 0 の腕）
    expect(events.some((e) => e.startsWith("A-ucb:") && e.includes("value"))).toBe(true);
    expect(events.every((e) => !e.startsWith("B-ucb:"))).toBe(true);


    host.remove();
  });
});
