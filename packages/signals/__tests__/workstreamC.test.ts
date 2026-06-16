import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isDev, warnDev, __resetDevWarnings } from "../src/dev.js";
import {
  signal,
  effect,
  computed,
  onCleanup,
  createRoot,
  flushSync,
} from "../src/reactive.js";
import { h, For, Index } from "../src/dom.js";

// ワークストリームC: 開発モード/サイレント故障の可視化。
// dev フラグ on/off の両分岐を必ず通し、afterEach でフラグを元に戻す。

declare global {
  // eslint-disable-next-line no-var
  var __WCS_DEV__: boolean | undefined;
}

function enableDev(): void {
  globalThis.__WCS_DEV__ = true;
  __resetDevWarnings();
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  __resetDevWarnings();
});

afterEach(() => {
  // フラグは必ず元に戻す（他テストへ漏らさない）。
  globalThis.__WCS_DEV__ = undefined;
  warnSpy.mockRestore();
  __resetDevWarnings();
});

// --- C1: dev フラグ基盤 ------------------------------------------------------

describe("C1: isDev / warnDev 基盤", () => {
  it("isDev はデフォルト false、__WCS_DEV__===true で true", () => {
    expect(isDev()).toBe(false);
    globalThis.__WCS_DEV__ = true;
    expect(isDev()).toBe(true);
    // true 以外（truthy だが厳密 true でない）は false 扱い。
    (globalThis as { __WCS_DEV__?: unknown }).__WCS_DEV__ = 1 as unknown as boolean;
    expect(isDev()).toBe(false);
  });

  it("warnDev は dev off では何も出さない（no-op）", () => {
    warnDev("DUPLICATE_KEY", "k", "msg");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warnDev は dev on で一度だけ出力し、同一キーは dedupe する", () => {
    enableDev();
    warnDev("DUPLICATE_KEY", "k1", "first", { a: 1 });
    warnDev("DUPLICATE_KEY", "k1", "again");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("[DUPLICATE_KEY]");
    expect(warnSpy.mock.calls[0][0]).toContain("first");
    // dedupe キーが違えば別物として出る。
    warnDev("DUPLICATE_KEY", "k2", "second");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("__resetDevWarnings で dedupe キャッシュがクリアされ再出力できる", () => {
    enableDev();
    warnDev("NULLISH_KEY", "x", "m");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    __resetDevWarnings();
    warnDev("NULLISH_KEY", "x", "m");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

// --- C2: For / Index のキー警告 ---------------------------------------------

describe("C2: For キー警告", () => {
  it("dev off: 非プリミティブ item を識別キーにしても警告は出ない", () => {
    const items = signal<readonly { id: number }[]>([{ id: 1 }, { id: 2 }]);
    const view = For(items, (it) => h("li", null, String(it.id)));
    const host = document.createElement("ul");
    createRoot(() => {
      view.mount(host);
    });
    flushSync();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("dev on: key 未指定 + 非プリミティブ item で NON_PRIMITIVE_KEY 警告", () => {
    enableDev();
    const items = signal<readonly { id: number }[]>([{ id: 1 }]);
    const view = For(items, (it) => h("li", null, String(it.id)));
    const host = document.createElement("ul");
    createRoot(() => {
      view.mount(host);
    });
    flushSync();
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("NON_PRIMITIVE_KEY"))).toBe(true);
  });

  it("dev on: key 指定があれば非プリミティブ item でも NON_PRIMITIVE_KEY は出ない", () => {
    enableDev();
    const items = signal<readonly { id: number }[]>([{ id: 1 }]);
    const view = For(items, (it) => h("li", null, String(it.id)), { key: (it) => it.id });
    const host = document.createElement("ul");
    createRoot(() => {
      view.mount(host);
    });
    flushSync();
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("NON_PRIMITIVE_KEY"))).toBe(false);
  });

  it("dev on: null / undefined / NaN キーで NULLISH_KEY 警告", () => {
    enableDev();
    const items = signal<readonly number[]>([1, 2]);
    const view = For(items, (n) => h("li", null, String(n)), {
      key: (_n, i) => (i === 0 ? null : NaN),
    });
    const host = document.createElement("ul");
    createRoot(() => {
      view.mount(host);
    });
    flushSync();
    const nullish = warnSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("NULLISH_KEY"));
    // null と NaN は別 dedupe キー（"null" と "NaN"）なので 2 回。
    expect(nullish.length).toBe(2);
  });

  it("dev on: 重複キーで DUPLICATE_KEY 警告 + 従来どおり throw（初期描画で投げる）", () => {
    enableDev();
    // mount の初期 effect 実行は同期。重複キーは warnDev 後に throw する（挙動維持）。
    expect(() =>
      createRoot((d) => {
        const items = signal<readonly number[]>([1, 1]);
        const view = For(items, (n) => h("li", null, String(n)), { key: () => "dup" });
        try {
          view.mount(document.createElement("ul"));
        } finally {
          d();
        }
      }),
    ).toThrow(/duplicate key/);
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("DUPLICATE_KEY"))).toBe(true);
  });

  it("dev off: 重複キーでも警告は出ず throw 挙動のみ維持", () => {
    expect(() =>
      createRoot((d) => {
        const items = signal<readonly number[]>([1, 1]);
        const view = For(items, (n) => h("li", null, String(n)), { key: () => "dup" });
        try {
          view.mount(document.createElement("ul"));
        } finally {
          d();
        }
      }),
    ).toThrow(/duplicate key/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("dev on: プリミティブキーが正常なら警告なし", () => {
    enableDev();
    const items = signal<readonly number[]>([1, 2, 3]);
    const view = For(items, (n) => h("li", null, String(n)));
    const host = document.createElement("ul");
    createRoot(() => {
      view.mount(host);
    });
    flushSync();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// --- C3: owner 不在の警告 ----------------------------------------------------

describe("C3: owner 不在の警告", () => {
  it("dev off: owner 無し effect でも警告なし", () => {
    const dispose = effect(() => {});
    expect(warnSpy).not.toHaveBeenCalled();
    dispose.dispose();
  });

  it("dev on: owner 無し effect で UNOWNED_EFFECT 警告", () => {
    enableDev();
    const handle = effect(() => {});
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("UNOWNED_EFFECT"))).toBe(true);
    handle.dispose();
  });

  it("dev on: createRoot 内 effect は owner があるので UNOWNED_EFFECT 出ない", () => {
    enableDev();
    createRoot((d) => {
      effect(() => {});
      d();
    });
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("UNOWNED_EFFECT"))).toBe(false);
  });

  it("dev on: owner 外 onCleanup は ORPHAN_CLEANUP 警告（no-op）", () => {
    enableDev();
    const fn = vi.fn();
    onCleanup(fn);
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("ORPHAN_CLEANUP"))).toBe(true);
  });

  it("dev off: owner 外 onCleanup は黙って no-op", () => {
    const fn = vi.fn();
    onCleanup(fn);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("dev on: owner 内 onCleanup は警告なし、teardown で実行される", () => {
    enableDev();
    const fn = vi.fn();
    createRoot((d) => {
      onCleanup(fn);
      d();
    });
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("ORPHAN_CLEANUP"))).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("dev on: owner 無し reactive child 挿入で UNOWNED_INSERT 警告", () => {
    enableDev();
    const n = signal(0);
    // h 内の reactive child を owner 無しで生成。
    h("div", null, () => n.get());
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("UNOWNED_INSERT"))).toBe(true);
  });

  it("dev off: owner 無し reactive child 挿入でも警告なし", () => {
    const n = signal(0);
    h("div", null, () => n.get());
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("dev on: createRoot 内 reactive child は UNOWNED_INSERT 出ない", () => {
    enableDev();
    const n = signal(0);
    createRoot((d) => {
      h("div", null, () => n.get());
      d();
    });
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("UNOWNED_INSERT"))).toBe(false);
  });
});

// --- C4: reactive cycle 診断 -------------------------------------------------

describe("C4: reactive cycle 診断情報", () => {
  it("dev off: cycle 超過 throw メッセージに dev 診断は含まれない", () => {
    // 2 つの effect が互いの依存に書き戻し、毎回値が変わる → 永久 cycle。
    const a = signal(0);
    const b = signal(0);
    let caught: Error | undefined;
    createRoot((d) => {
      effect(() => {
        b.set(a.get() + 1);
      });
      effect(() => {
        a.set(b.get() + 1);
      });
      try {
        flushSync();
      } catch (e) {
        caught = e as Error;
      }
      d();
    });
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toContain("exceeded 1000 iterations");
    // dev off では診断行は付かない。
    expect(caught!.message).not.toContain("dev diagnostics");
  });

  it("dev on: cycle 超過 throw メッセージに dev 診断（still re-running）が含まれる", () => {
    enableDev();
    const a = signal(0);
    const b = signal(0);
    let caught: Error | undefined;
    createRoot((d) => {
      effect(() => {
        b.set(a.get() + 1);
      });
      effect(() => {
        a.set(b.get() + 1);
      });
      try {
        flushSync();
      } catch (e) {
        caught = e as Error;
      }
      d();
    });
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toContain("exceeded 1000 iterations");
    expect(caught!.message).toContain("dev diagnostics");
    expect(caught!.message).toContain("still re-running");
  });

  it("dev を後から on にした場合（effect は dev off で生成）、stack 無しでも診断は出る", () => {
    // effect 生成時は dev off → _devStack 未取得。flush 直前に dev on にすると
    // describeCycle は "(no stack)" フォールバックを使う。
    const a = signal(0);
    const b = signal(0);
    let caught: Error | undefined;
    createRoot((d) => {
      effect(() => {
        b.set(a.get() + 1);
      });
      effect(() => {
        a.set(b.get() + 1);
      });
      enableDev(); // 生成後に dev を有効化
      try {
        flushSync();
      } catch (e) {
        caught = e as Error;
      }
      d();
    });
    expect(caught!.message).toContain("dev diagnostics");
    expect(caught!.message).toContain("(no stack)");
  });
});

// --- Index も owner 配下で正常動作（回帰確認） ------------------------------

describe("C: Index は dev on でも従来どおり動作", () => {
  it("dev on: Index の通常レンダリングで余計な警告を出さない", () => {
    enableDev();
    const items = signal<readonly number[]>([1, 2]);
    const view = Index(items, (it) => h("li", null, () => String(it())));
    const host = document.createElement("ul");
    createRoot((d) => {
      view.mount(host);
      d();
    });
    flushSync();
    expect(host.querySelectorAll("li").length).toBe(2);
  });
});
