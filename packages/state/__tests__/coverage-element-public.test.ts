/**
 * coverage-element-public.test.ts — the smaller public pieces: `analyzeContract`
 * (src/public/contract.ts) on partial or broken manifests and declarations, the `<wcs-ssr>`
 * snapshot reader (src/ssr/element.ts), `defineState` (src/public/defineState.ts) and the
 * idempotent filter installers (src/filters/core.ts, src/filters/formats.ts).
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapState, getBindingsReady } from "../src/index";
import { analyzeContract, defineState, Ssr, VERSION } from "../src/exports";
import { defineSsr } from "../src/ssr/element";
import { setConfig } from "../src/config";
import { installCoreFilters } from "../src/filters/core";
import { installFormats } from "../src/filters/formats";
import { registerFilters } from "../src/filters/registry";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-public-${seq++}`);
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

describe("analyzeContract（有効時）", () => {
  afterEach(() => {
    setConfig({ enableContractAnalyzer: false });
  });

  it("manifestExtensions が無い・オブジェクトでないマニフェストは何も報告しない", () => {
    setConfig({ enableContractAnalyzer: true });
    expect(analyzeContract({})).toEqual([]);
    expect(analyzeContract({ manifestExtensions: null } as any)).toEqual([]);
    expect(analyzeContract({ manifestExtensions: "wcstack.types" } as any)).toEqual([]);
  });

  it("wcstack.types の components が無ければ、知らない名前空間だけを報告する（既知の名前空間は黙る）", () => {
    setConfig({ enableContractAnalyzer: true });
    const extensions = { "wcstack.async": {}, "wcstack.platformCapabilities": {}, "wcstack.application": {}, "vendor.x": {} };
    expect(analyzeContract({ manifestExtensions: { ...extensions, "wcstack.types": {} } })).toEqual([
      { type: "contract:unsupported-extension", namespace: "vendor.x" },
    ]);
    expect(analyzeContract({ manifestExtensions: { "wcstack.types": { components: null } } } as any)).toEqual([]);
  });

  it("壊れた component の項目（null・数値）は空の契約として読み、inputs だけの項目は inputs を照合する", () => {
    setConfig({ enableContractAnalyzer: true });
    const tag = `cov-contract-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "value", event: `${tag}:change` }], inputs: [{ name: "value" }] };
    });
    const other = `cov-contract-${seq++}`;
    customElements.define(other, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [] };
    });
    const events = analyzeContract({
      manifestExtensions: { "wcstack.types": { components: { [tag]: { inputs: { value: {}, url: {} } }, [other]: null as any } } },
    });
    expect(events).toEqual([
      { type: "contract:manifest-read", tag, loaded: true },
      { type: "contract:drift", reason: "missing-member", tag, member: "url" },
      { type: "contract:manifest-read", tag: other, loaded: true },
    ]);
    expect(analyzeContract({ manifestExtensions: { "wcstack.types": { components: { [other]: 5 as any } } } })).toEqual([
      { type: "contract:manifest-read", tag: other, loaded: true },
    ]);
  });

  it("要素の宣言の配列でない欄・名前や event の無い項目は無いものとして照合する", () => {
    setConfig({ enableContractAnalyzer: true });
    const tag = `cov-contract-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = {
        protocol: "wc-bindable", version: 1,
        properties: [{ name: "a" }, null, { event: `${tag}:b` }, { name: "ok", event: `${tag}:ok` }],
        inputs: "value",
        commands: [{ name: 1 }, null, { name: "run" }],
      };
    });
    const events = analyzeContract({
      manifestExtensions: {
        "wcstack.types": {
          components: {
            [tag]: {
              observables: { a: {}, ok: null as any, b: { event: `${tag}:b` } },
              inputs: { value: {} },
              commands: { run: {}, "1": {} },
            },
          },
        },
      },
    });
    expect(events).toEqual([
      { type: "contract:manifest-read", tag, loaded: true },
      { type: "contract:drift", reason: "missing-member", tag, member: "a" },
      { type: "contract:drift", reason: "missing-member", tag, member: "b" },
      { type: "contract:drift", reason: "missing-member", tag, member: "value" },
      { type: "contract:drift", reason: "missing-member", tag, member: "1" },
    ]);
  });

  it("登録済みでも wc-bindable でない要素は読み込まれていないものとして報告する", () => {
    setConfig({ enableContractAnalyzer: true });
    const plain = `cov-contract-${seq++}`;
    customElements.define(plain, class extends HTMLElement {});
    const foreign = `cov-contract-${seq++}`;
    customElements.define(foreign, class extends HTMLElement {
      static wcBindable = { protocol: "other", version: 1, properties: [] };
    });
    expect(analyzeContract({ manifestExtensions: { "wcstack.types": { components: { [plain]: {}, [foreign]: {} } } } })).toEqual([
      { type: "contract:manifest-read", tag: plain, loaded: false },
      { type: "contract:drift", reason: "component-not-loaded", tag: plain },
      { type: "contract:manifest-read", tag: foreign, loaded: false },
      { type: "contract:drift", reason: "component-not-loaded", tag: foreign },
    ]);
  });
});

describe("<wcs-ssr> のスナップショットの読み取り（Ssr）", () => {
  beforeAll(() => {
    defineSsr(customElements);
  });

  it("defineSsr は登録簿ごとに 1 回だけ定義する", () => {
    const cls = customElements.get("wcs-ssr");
    expect(cls).toBeDefined();
    defineSsr(customElements);
    expect(customElements.get("wcs-ssr")).toBe(cls);
    expect(document.createElement("wcs-ssr")).toBeInstanceOf(Ssr);
  });

  it("Ssr.find はスナップショットが無い根・要素を持たないノードで null を返す", () => {
    const host = document.createElement("div");
    host.innerHTML = `<p>no snapshot</p>`;
    expect(Ssr.find(host)).toBeNull();
    expect(Ssr.find(document.createTextNode("x"))).toBeNull();
  });

  it("version 属性・JSON の <script> が無い（または空の）スナップショットは、空の版・空の状態として読み、版の検証に通らない", () => {
    const host = document.createElement("div");
    host.innerHTML = `<wcs-ssr></wcs-ssr>`;
    const bare = Ssr.find(host)!;
    expect(bare.version).toBe("");
    expect(bare.verifyVersion()).toBe(false);
    expect(bare.stateData).toEqual({});
    expect(bare.templates.size).toBe(0);
    host.innerHTML = `<wcs-ssr version="${VERSION}"><script type="application/json"></script><template id="t1"></template><div id="t2"></div></wcs-ssr>`;
    const empty = Ssr.find(host)!;
    expect(empty.verifyVersion()).toBe(true);
    expect(empty.stateData).toEqual({});
    expect([...empty.templates.keys()]).toEqual(["t1"]);
    expect(empty.getTemplate("t2")).toBeNull();
  });

  it("版の検証は major.minor だけを比べる", () => {
    const [major, minor] = VERSION.split(".");
    const host = document.createElement("div");
    host.innerHTML = `<wcs-ssr version="${major}.${minor}.999"></wcs-ssr><wcs-ssr version="${Number(major) + 1}.${minor}.0"></wcs-ssr>`;
    const [same, other] = Array.from(host.querySelectorAll("wcs-ssr")) as unknown as Ssr[];
    expect(same.verifyVersion()).toBe(true);
    expect(other.verifyVersion()).toBe(false);
  });
});

describe("defineState", () => {
  it("定義をそのまま返し、その定義で <wcs-state> を初期化できる", async () => {
    const definition = {
      count: 1,
      get double() { return (this as any).count * 2; },
      bump(this: any) { this.count++; },
    };
    expect(defineState(definition)).toBe(definition);
    const { root } = await page(`<p>{{ double }}</p><button data-wcs="onclick: bump">+</button>`, defineState(definition));
    (root.querySelector("button") as HTMLElement).click();
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("4");
  });
});

describe("フィルタの導入は冪等", () => {
  it("installCoreFilters・installFormats の 2 回目は登録し直さない（後から登録した同名のフィルタが残る）", async () => {
    installCoreFilters();
    installFormats();
    registerFilters({
      not: { factory: () => (v: unknown) => `custom-not:${String(v)}`, arity: [0, 0] },
      upper: { factory: () => (v: unknown) => `custom-upper:${String(v)}`, arity: [0, 0] },
    });
    installCoreFilters();
    installFormats();
    const { root } = await page(`<p class="a">{{ flag|not }}</p><p class="b">{{ name|upper }}</p>`, { flag: true, name: "ab" });
    expect(root.querySelector(".a")!.textContent).toBe("custom-not:true");
    expect(root.querySelector(".b")!.textContent).toBe("custom-upper:ab");
  });
});
