// counter-assist の継ぎ目アプリ（docs/seam-apps.md、4.33。docs/v4-direction-2026-10.md §5.29）から:
//   - resource / streamResource は source の中で読んだ signal を追わない（再開を決めるのは args だけ — 文書どおり）。
//     source は args を読む effect の中で同期に呼ばれるので、最初の await より前の読みが偶然 effect の依存になっていた。
//   - 反応の核の 2 つ目の写しが読み込まれたら、その写しが一度だけ知らせる（入口 2 つを別々に束ねる CDN・2 つの版）。
import { describe, it, expect, vi } from "vitest";
import { signal, flushSync, effect } from "../src/reactive.js";
import { resource } from "../src/resource.js";
import { streamResource } from "../src/streamResource.js";

const flushAsync = () => new Promise((r) => setTimeout(r, 0));

describe("resource / streamResource は source の中の読みを追わない", () => {
  it("resource: source が同期に読んだ signal が変わっても再開しない。args の変化では再開する", async () => {
    const id = signal(1);
    const token = signal("a");
    const calls: string[] = [];
    const r = resource((a: number) => {
      calls.push(`${a}:${token.get()}`);
      return Promise.resolve(a);
    }, { args: () => id.get() });
    await flushAsync();
    token.set("b");
    flushSync();
    await flushAsync();
    expect(calls).toEqual(["1:a"]);
    id.set(2);
    flushSync();
    await flushAsync();
    expect(calls).toEqual(["1:a", "2:b"]);
    r.dispose();
  });

  it("streamResource: source が同期に読んだ signal が変わっても再開しない。args の変化では再開する", async () => {
    const id = signal(1);
    const token = signal("a");
    const calls: string[] = [];
    const s = streamResource((a: number) => {
      calls.push(`${a}:${token.get()}`);
      return (async function* () { yield a; })();
    }, { args: () => id.get() });
    await flushAsync();
    token.set("b");
    flushSync();
    await flushAsync();
    expect(calls).toEqual(["1:a"]);
    id.set(2);
    flushSync();
    await flushAsync();
    expect(calls).toEqual(["1:a", "2:b"]);
    s.dispose();
  });

  it("source の中の読みを外しても、外側の effect の追跡は元に戻る", async () => {
    const outer = signal(0);
    const inner = signal(0);
    let runs = 0;
    const e = effect(() => {
      runs++;
      outer.get();
      resource(() => { inner.get(); return Promise.resolve(1); });
      outer.get();
    });
    flushSync();
    inner.set(1);
    flushSync();
    expect(runs).toBe(1);
    outer.set(1);
    flushSync();
    expect(runs).toBe(2);
    e.dispose();
    await flushAsync();
  });
});

describe("反応の核の 2 つ目の写し（wcs/signals-second-core）", () => {
  it("同じページで 2 つ目の写しが評価されると一度知らせ、1 つ目は何も言わずに印を付ける", async () => {
    const CORE = Symbol.for("wcstack.signals.core");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = globalThis as any;
    const before = g[CORE];
    try {
      delete g[CORE];
      vi.resetModules();
      await import("../src/reactive.js");
      expect(g[CORE]).toBe(true);
      expect(warn).not.toHaveBeenCalled();
      vi.resetModules();
      await import("../src/reactive.js");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toBe(
        "[@wcstack/signals] [wcs/signals-second-core] A second copy of the reactive core was loaded: a signal of one copy is not seen by an effect, a computed or a binding of the other (a clock that never ticks). Import every name from one entry at one URL — @wcstack/signals/dom has all of them.",
      );
    } finally {
      g[CORE] = before;
      warn.mockRestore();
    }
  });
});
