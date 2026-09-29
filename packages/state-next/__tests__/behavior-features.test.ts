/**
 * behavior-features.test.ts — 状態の `$behavior`（その木の振る舞い）と `$features`（その状態が要る後付け）、
 * `bootstrapState` の設定の検査（docs/state-engine-rewrite/config-impl-plan.ja.md §2）。
 * 後付けは入れない（core だけ）。`hooks.load` は分割 auto が埋める受け口で、ここでは偽物を置く。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, ssr } from "../src/index";
import { config, getConfig, setConfig } from "../src/config";
import { hooks, loadFeatures } from "../src/hooks";
import { M } from "../src/messages";

// the core's own message (no diagnostics add-on here): [@wcstack/state] [wcs/<code>] #<number> <values>
const core = (id: M) => new RegExp(String.raw`^\[@wcstack/state\] (\[wcs/[\w-]+\] )?#${id}( |$)`);

const flush = () => new Promise((r) => setTimeout(r, 0));
const make = (state: Record<string, any>) => new Engine(state, new DirtyStrategy());
let seq = 0;

beforeAll(() => {
  bootstrapState();
});
afterEach(() => {
  hooks.load = null;
});

/** A root `<wcs-state>` in a shadow root, `state` set before it connects; not awaited. */
function mountPage(html: string, state: Record<string, any>, attrs = "") {
  const h = document.createElement(`behavior-test-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state${attrs}></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  return { root, el };
}

describe("$behavior", () => {
  it("書かなければ 3 つとも true、書いたものだけが変わる", () => {
    const d = make({});
    expect([d.mustache, d.guard, d.directional]).toEqual([true, true, true]);
    const e = make({ $behavior: { enableMustache: false, enableDirectionalInitialSync: false } });
    expect([e.mustache, e.guard, e.directional]).toEqual([false, true, false]);
  });

  it("知らないキー・boolean でない値・オブジェクトでない $behavior は投げる", () => {
    expect(() => make({ $behavior: { debug: true } })).toThrow(core(M.OptionInvalid));
    expect(() => make({ $behavior: { debug: true } })).toThrow('"$behavior" "debug"');
    expect(() => make({ $behavior: { sameValueGuard: "no" } })).toThrow('"$behavior" "sameValueGuard"');
    expect(() => make({ $behavior: 5 })).toThrow('"state" "$behavior"');
    expect(make({ $behavior: null }).guard).toBe(true);
  });

  it("再セットは同じ $behavior なら通り、変わる（省いて既定に戻るのも）と投げる", () => {
    const e = make({ n: 1, $behavior: { sameValueGuard: false } });
    e.reset({ n: 2, $behavior: { sameValueGuard: false } });
    expect(e.proxy.n).toBe(2);
    expect(() => e.reset({ n: 3 })).toThrow(core(M.BehaviorChanged));
    expect(() => e.reset({ n: 3, $behavior: { sameValueGuard: true } })).toThrow(core(M.BehaviorChanged));
    const d = make({ n: 1 });
    d.reset({ n: 2, $behavior: { enableMustache: true } });
    expect(d.proxy.n).toBe(2);
  });

  it("sameValueGuard: false の木は同じ値の書き込みも通す（木ごとに違ってよい）", () => {
    const on = make({ n: 1 });
    const off = make({ n: 1, $behavior: { sameValueGuard: false } });
    const landed: Engine[] = [];
    hooks.written = (engine) => { landed.push(engine); };
    try {
      on.proxy.n = 1;
      off.proxy.n = 1;
    } finally {
      hooks.written = null;
    }
    expect(landed).toEqual([off]);
  });
});

describe("bootstrapState の設定", () => {
  const DEFAULTS = { ...getConfig(), tagNames: { ...getConfig().tagNames } };
  afterEach(() => {
    setConfig(DEFAULTS);
  });

  it("undefined の値は飛ばし、tagNames はオブジェクトだけを受ける", () => {
    setConfig({ locale: undefined, commentForPrefix: "x-for" });
    expect(config.locale).toBe(DEFAULTS.locale);
    expect(config.commentForPrefix).toBe("x-for");
    expect(() => setConfig({ tagNames: "my-state" as any })).toThrow('"bootstrapState" "tagNames"');
    expect(config.tagNames).toEqual(DEFAULTS.tagNames);
  });

  it.each(["enableMustache", "sameValueGuard", "enableDirectionalInitialSync", "debug", "commentTextPrefix", "enablePropagationContext"])(
    "4.0 で $behavior へ移ったキー・消えたキー（%s）は投げる",
    (key) => {
      expect(() => setConfig({ [key]: true } as any)).toThrow(core(M.OptionInvalid));
    },
  );
});

describe("$features（読み込む口が無い: 全部入り・バンドラは検査だけ）", () => {
  it("入っていない名前は、入れる入口を案内して初期化に失敗する", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { el } = mountPage(``, { $features: ["temporal"] });
    await expect(el.connectedCallbackPromise).rejects.toThrow("[wcs/feature-not-installed] $features needs the add-on @wcstack/state/features/temporal");
    error.mockRestore();
  });

  it("入っている名前は通り、配列でなければ投げる", () => {
    installFeatures([{ name: "fake-installed", install() {} }]);
    expect(make({ $features: ["fake-installed"] }).proxy).toBeDefined();
    expect(() => make({ $features: "fake-installed" })).toThrow(core(M.FeaturesNotArray));
  });

  it("再セットは同期なので、検査だけをする", async () => {
    const { el } = mountPage(``, { n: 1 });
    await el.connectedCallbackPromise;
    expect(() => el.setInitialState({ n: 2, $features: ["fake-missing"] })).toThrow("[wcs/feature-not-installed]");
  });
});

describe("loadFeatures と hooks.load（分割 auto の受け口）", () => {
  it("待つものが無ければ undefined（起動の microtask を増やさない）", () => {
    expect(loadFeatures({ $features: ["fake-a"] })).toBeUndefined();
    hooks.load = vi.fn(async () => {});
    installFeatures([{ name: "fake-there", install() {} }]);
    expect(loadFeatures({})).toBeUndefined();
    expect(loadFeatures({ $features: "fake-a" })).toBeUndefined();
    expect(loadFeatures({ $features: ["fake-there"] })).toBeUndefined();
    expect(hooks.load).not.toHaveBeenCalled();
  });

  it("足りない名前だけを読み込み、終わってからエンジンを作る", async () => {
    let release!: () => void;
    const load = vi.fn((names: string[]) => new Promise<void>((resolve) => {
      release = () => {
        installFeatures(names.map((name) => ({ name, install() {} })));
        resolve();
      };
    }));
    hooks.load = load;
    installFeatures([{ name: "fake-have", install() {} }]);
    const { root, el } = mountPage(`<p>{{ n }}</p>`, { n: 1, $features: ["fake-have", "fake-b", "fake-c"] });
    await flush();
    expect(load).toHaveBeenCalledWith(["fake-b", "fake-c"]);
    expect(el.engine).toBe(null);
    expect(root.querySelector("p")!.textContent).toBe("{{ n }}");
    release();
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    expect(root.querySelector("p")!.textContent).toBe("1");
  });

  it("読み込みの失敗は、その要素の初期化の失敗になる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    hooks.load = () => Promise.reject(new Error("network down"));
    const { el } = mountPage(``, { $features: ["fake-offline"] });
    await expect(el.connectedCallbackPromise).rejects.toThrow("network down");
    error.mockRestore();
  });

  // installs the real ssr add-on: last in the file
  it("enable-ssr は読み込みの後に検査する（$features で ssr を読み込めば通る）", async () => {
    hooks.load = async (names) => {
      expect(names).toEqual(["ssr"]);
      installFeatures([ssr]);
    };
    const { root, el } = mountPage(`<p>{{ n }}</p>`, { n: 4, $features: ["ssr"] }, " enable-ssr");
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    expect(root.querySelector("p")!.textContent).toBe("4");
  });
});
