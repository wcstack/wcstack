import { describe, it, expect, afterEach } from "vitest";
import { MediaQueryCore } from "../src/core/MediaQueryCore";
import { FakeMatchMedia, installMatchMedia, removeMatchMedia, restoreMatchMedia } from "./mocks";

const DARK = "(prefers-color-scheme: dark)";
const NARROW = "(max-width: 600px)";

function collect(core: MediaQueryCore): any[] {
  const events: any[] = [];
  core.addEventListener("wcs-media-query:change", (e) => events.push((e as CustomEvent).detail));
  return events;
}

describe("MediaQueryCore", () => {
  afterEach(() => {
    restoreMatchMedia();
  });

  describe("初期状態（observe 前）", () => {
    it("全プロパティが既定値（matched=false / media='' / supported=false / query=''）", () => {
      const core = new MediaQueryCore();
      expect(core.matched).toBe(false);
      expect(core.media).toBe("");
      expect(core.supported).toBe(false);
      expect(core.query).toBe("");
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new MediaQueryCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("observe() — 対応環境（注入 matchMedia）", () => {
    it("observe(query) で即座に snapshot を反映し change を dispatch する", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      const events = collect(core);

      core.observe(DARK);

      expect(mm.queries).toEqual([DARK]);
      expect(core.query).toBe(DARK);
      expect(core.matched).toBe(true);
      expect(core.media).toBe(DARK);
      expect(core.supported).toBe(true);
      expect(events).toEqual([{ matched: true, media: DARK, supported: true }]);
    });

    it("observe() は冪等 — 同じ query の二重呼び出しで matchMedia を再度呼ばず再 dispatch もしない", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      const events = collect(core);

      core.observe(DARK);
      core.observe(DARK);

      expect(mm.queries).toEqual([DARK]);
      expect(mm.last.listeners.size).toBe(1);
      expect(events).toHaveLength(1);
    });

    it("引数省略の observe() は現在の query を維持する（再接続経路）", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      core.dispose();

      core.observe();

      expect(mm.queries).toEqual([DARK, DARK]);
      expect(core.query).toBe(DARK);
      expect(core.matched).toBe(true);
    });

    it("observe() 後に購読したリスナーには初回スナップショットは届かない（現仕様の明示）", () => {
      // wc-bindable のイベントは後から購読した相手に再送されない純 pub-sub。
      // 初期値が必要な消費者は要素プロパティを直接 pull する（README「Notes & limitations」）。
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      const events = collect(core);

      expect(events).toEqual([]);
      expect(core.matched).toBe(true);

      mm.last.setMatches(false);
      expect(events).toHaveLength(1);
    });

    it("options を渡しても matchMedia が無ければ globalThis を解決する", () => {
      const global = installMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, {});
      core.observe(DARK);
      expect(global.queries).toEqual([DARK]);
      expect(core.matched).toBe(true);
    });
  });

  describe("observe() — globalThis.matchMedia の呼び出し時解決", () => {
    it("globalThis.matchMedia 不在なら supported=false のまま、既定値と同値なので change は dispatch しない", () => {
      removeMatchMedia();
      const core = new MediaQueryCore();
      const events = collect(core);

      core.observe(DARK);

      expect(core.supported).toBe(false);
      expect(core.matched).toBe(false);
      expect(core.media).toBe("");
      expect(events).toEqual([]);
    });

    it("後から globalThis.matchMedia が現れれば次の observe() で supported=true になる（キャッシュしない）", () => {
      removeMatchMedia();
      const core = new MediaQueryCore();
      core.observe(DARK);
      expect(core.supported).toBe(false);

      core.dispose();
      const global = installMatchMedia({ matches: true });
      core.observe(DARK);

      expect(global.queries).toEqual([DARK]);
      expect(core.supported).toBe(true);
      expect(core.matched).toBe(true);
    });

    it("globalThis.matchMedia の呼び出しで this が globalThis に保たれる（unbound 呼び出しで throw する実装対策）", () => {
      const seen: unknown[] = [];
      Object.defineProperty(globalThis, "matchMedia", {
        configurable: true,
        writable: true,
        value: function (this: unknown, query: string) {
          seen.push(this);
          return { matches: true, media: query };
        },
      });
      const core = new MediaQueryCore();
      core.observe(DARK);
      expect(seen).toEqual([globalThis]);
      expect(core.matched).toBe(true);
    });
  });

  describe("空 query", () => {
    it("query='' は「何も監視しない」— matched=false / media='' だが supported は true", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      const events = collect(core);

      core.observe("");

      expect(mm.queries).toEqual([]);
      expect(core.supported).toBe(true);
      expect(core.matched).toBe(false);
      expect(core.media).toBe("");
      expect(events).toEqual([{ matched: false, media: "", supported: true }]);
    });

    it("実 query → '' への変更で購読を解除し matched が false に落ちる", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      const first = mm.last;

      core.observe("");

      expect(first.listeners.size).toBe(0);
      expect(core.matched).toBe(false);
      expect(core.media).toBe("");
    });
  });

  describe("change イベントの追従", () => {
    it("MediaQueryList の change で matched が更新され再 dispatch する", () => {
      const mm = new FakeMatchMedia({ matches: false });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      const events = collect(core);

      mm.last.setMatches(true);

      expect(core.matched).toBe(true);
      expect(events).toEqual([{ matched: true, media: DARK, supported: true }]);
    });

    it("同値の change 連続発火では再 dispatch しない（同値ガード）", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      const events = collect(core);

      mm.last.fire();
      mm.last.fire();

      expect(events).toEqual([]);
    });

    it("media 単独の変化でも dispatch する（同値ガードが 3 フィールド全てを比較している）", () => {
      // 実ブラウザで media だけが変わることは無いが、ガードがフィールド単位で
      // 見ていることの検証。matched 単独は上のテスト、supported 単独は
      // 呼び出し時解決テストが押さえる。
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      const events = collect(core);

      mm.last.media = "not all";
      mm.last.fire();

      expect(events).toHaveLength(1);
      expect(core.media).toBe("not all");
    });

    it("media が文字列でない実装では '' に正規化する", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      (mm.last as any).media = undefined;
      (mm.last as any).matches = "yes"; // boolean でない → false
      mm.last.fire();

      expect(core.media).toBe("");
      expect(core.matched).toBe(false);
      expect(core.supported).toBe(true);
    });
  });

  describe("query の変更（張り替え）", () => {
    it("別 query の observe() で旧リストの購読を解除し新リストを購読する", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      const first = mm.last;

      mm.next({ matches: false });
      core.observe(NARROW);

      expect(mm.queries).toEqual([DARK, NARROW]);
      expect(first.listeners.size).toBe(0);
      expect(mm.last.listeners.size).toBe(1);
      expect(core.query).toBe(NARROW);
      expect(core.matched).toBe(false);
      expect(core.media).toBe(NARROW);
    });

    it("世代ガード: 解除に失敗した旧リストの change は新 query の状態を書き換えない", () => {
      const mm = new FakeMatchMedia({ matches: false, leaky: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      const stale = mm.last;
      expect(stale.listeners.size).toBe(1);

      mm.next({ matches: false, leaky: false });
      core.observe(NARROW);
      const events = collect(core);

      // leaky なので旧リストはまだリスナーを保持している
      expect(stale.listeners.size).toBe(1);
      stale.setMatches(true);

      expect(core.matched).toBe(false);
      expect(core.media).toBe(NARROW);
      expect(events).toEqual([]);
    });

    it("世代ガード: dispose 後に届く旧リストの change も無視する", () => {
      const mm = new FakeMatchMedia({ matches: false, leaky: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      const stale = mm.last;
      core.dispose();
      const events = collect(core);

      stale.setMatches(true);

      expect(core.matched).toBe(false);
      expect(events).toEqual([]);
    });
  });

  describe("リスナー API のフォールバック", () => {
    it("addListener/removeListener しか無い旧 Safari 形でも change を追従し dispose で解除する", () => {
      const mm = new FakeMatchMedia({ matches: false, surface: "legacy" });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      expect(mm.last.listeners.size).toBe(1);

      mm.last.setMatches(true);
      expect(core.matched).toBe(true);

      core.dispose();
      expect(mm.last.listeners.size).toBe(0);
    });

    it("addEventListener があっても removeEventListener が無ければ旧 API ペアを使う", () => {
      const mm = new FakeMatchMedia({ matches: true, surface: "mixed" });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      expect(mm.last.listeners.size).toBe(1);
      core.dispose();
      expect(mm.last.listeners.size).toBe(0);
    });

    it("どちらの API も無い静的リストは初回スナップショットのみ（購読なし・dispose も安全）", () => {
      const mm = new FakeMatchMedia({ matches: true, surface: "static" });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);

      expect(core.matched).toBe(true);
      expect(mm.last.listeners.size).toBe(0);
      expect(() => core.dispose()).not.toThrow();
    });
  });

  describe("never-throw", () => {
    it("matchMedia が throw しても observe() は落ちず、matched=false / media='' / supported=true を報告する", () => {
      const mm = new FakeMatchMedia({ matches: true }).throwNext();
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      const events = collect(core);

      expect(() => core.observe(DARK)).not.toThrow();

      expect(core.supported).toBe(true);
      expect(core.matched).toBe(false);
      expect(core.media).toBe("");
      expect(events).toEqual([{ matched: false, media: "", supported: true }]);
      expect(() => core.dispose()).not.toThrow();
    });

    it("removeEventListener が throw しても dispose() は落ちない", () => {
      const mm = new FakeMatchMedia({ matches: true, throwOnRemove: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      expect(() => core.dispose()).not.toThrow();
    });
  });

  describe("dispose()", () => {
    it("dispose 後は change を受けても状態が変わらず、リスナーも解除されている", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      core.dispose();

      expect(mm.last.listeners.size).toBe(0);
      mm.last.matches = false;
      mm.last.fire();
      expect(core.matched).toBe(true); // 最後のスナップショットを保持
    });

    it("一度も observe していない dispose は安全な no-op", () => {
      const core = new MediaQueryCore();
      expect(() => core.dispose()).not.toThrow();
    });

    it("dispose→observe で再購読し、新しいリストの値を反映する", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const core = new MediaQueryCore(undefined, { matchMedia: mm.matchMedia });
      core.observe(DARK);
      core.dispose();

      mm.next({ matches: false });
      core.observe(DARK);

      expect(mm.queries).toEqual([DARK, DARK]);
      expect(core.matched).toBe(false);

      mm.last.setMatches(true);
      expect(core.matched).toBe(true);
    });
  });

  describe("target 指定", () => {
    it("target を渡すとそこへ change を dispatch する", () => {
      const mm = new FakeMatchMedia({ matches: true });
      const target = new EventTarget();
      const events: any[] = [];
      target.addEventListener("wcs-media-query:change", (e) => events.push((e as CustomEvent).detail));

      const core = new MediaQueryCore(target, { matchMedia: mm.matchMedia });
      core.observe(DARK);

      expect(events).toEqual([{ matched: true, media: DARK, supported: true }]);
    });
  });

  describe("wcBindable プロトコル宣言", () => {
    it("commands は空（純粋 monitor）", () => {
      expect(MediaQueryCore.wcBindable.commands).toEqual([]);
    });

    it("各 property の getter が event.detail から正しく値を取り出す", () => {
      const byName = (n: string) => MediaQueryCore.wcBindable.properties.find((p) => p.name === n)!;
      const detail = { matched: true, media: DARK, supported: true };
      const ev = new CustomEvent("wcs-media-query:change", { detail });

      expect(byName("matched").getter!(ev)).toBe(true);
      expect(byName("media").getter!(ev)).toBe(DARK);
      expect(byName("supported").getter!(ev)).toBe(true);
    });

    it("全 property が semantics: state を宣言する", () => {
      for (const p of MediaQueryCore.wcBindable.properties) {
        expect(p.semantics).toBe("state");
        expect(p.event).toBe("wcs-media-query:change");
      }
    });
  });
});
