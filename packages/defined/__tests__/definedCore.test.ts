import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DefinedCore } from "../src/core/DefinedCore.js";
import { DefinedSnapshot } from "../src/types.js";
import { uniqueTag, defineTag, flush, expectInvariant } from "./helpers.js";

// Attach a listener and collect every dispatched snapshot. Returns the core and
// the recorded snapshots. Use with observe() (not the constructor) so the first
// publish is captured — the constructor publishes before a listener can attach.
function watch(): { core: DefinedCore; events: DefinedSnapshot[] } {
  const core = new DefinedCore();
  const events: DefinedSnapshot[] = [];
  core.addEventListener("wcs-defined:change", (e) => events.push((e as CustomEvent<DefinedSnapshot>).detail));
  return { core, events };
}

describe("DefinedCore", () => {
  describe("接続前に定義済みのタグ", () => {
    it("同期的に count に算入され mode=all で defined になる", () => {
      const t = uniqueTag();
      defineTag(t);
      const core = new DefinedCore([t], "all", 0);
      expect(core.defined).toBe(true);
      expect(core.count).toBe(1);
      expect(core.total).toBe(1);
      expect(core.pending).toEqual([]);
      expect(core.missing).toEqual([]);
      expect(core.error).toBeNull();
    });

    it("mode=any でも 1 つ定義済みなら defined になる", () => {
      const a = uniqueTag();
      const b = uniqueTag();
      defineTag(a);
      const core = new DefinedCore([a, b], "any", 0);
      expect(core.defined).toBe(true);
      expect(core.count).toBe(1);
      expect(core.pending).toEqual([b]);
    });
  });

  describe("遅延定義", () => {
    it("pending→count へ遷移し再 publish、mode=all は全解決で defined になる", async () => {
      const a = uniqueTag();
      const b = uniqueTag();
      const { core, events } = watch();
      core.observe([a, b], "all", 0);

      // 初回 publish: 両方 pending
      expect(events).toHaveLength(1);
      expect(core.defined).toBe(false);
      expect(core.pending).toEqual([a, b]);

      defineTag(a);
      await flush();
      expect(core.count).toBe(1);
      expect(core.pending).toEqual([b]);
      expect(core.defined).toBe(false);
      expect(events).toHaveLength(2);

      defineTag(b);
      await flush();
      expect(core.count).toBe(2);
      expect(core.pending).toEqual([]);
      expect(core.defined).toBe(true);
      expect(events).toHaveLength(3);
      events.forEach(expectInvariant);
    });

    it("ready は全タグ解決で resolve する", async () => {
      const t = uniqueTag();
      const core = new DefinedCore([t], "all", 0);
      let settled = false;
      core.ready.then(() => { settled = true; });
      await flush();
      expect(settled).toBe(false);

      defineTag(t);
      await flush();
      expect(settled).toBe(true);
    });
  });

  describe("mode=any", () => {
    it("1 つ定義された時点で defined=true、残りは pending に残る", async () => {
      const a = uniqueTag();
      const b = uniqueTag();
      const core = new DefinedCore([a, b], "any", 0);
      expect(core.defined).toBe(false);

      defineTag(a);
      await flush();
      expect(core.defined).toBe(true);
      expect(core.count).toBe(1);
      expect(core.pending).toEqual([b]);
    });

    it("defined=true でも残りが pending なら ready は未解決のまま", async () => {
      const a = uniqueTag();
      const b = uniqueTag();
      const core = new DefinedCore([a, b], "any", 0);
      let settled = false;
      core.ready.then(() => { settled = true; });

      defineTag(a);
      await flush();
      // mode=any なので defined は即 true、しかし b がまだ pending なので
      // 終端していない → ready は resolve しない（defined と ready は別概念）。
      expect(core.defined).toBe(true);
      expect(core.pending).toEqual([b]);
      expect(settled).toBe(false);

      // 残り b が解決すれば終端し ready が resolve する。
      defineTag(b);
      await flush();
      expect(core.pending).toEqual([]);
      expect(settled).toBe(true);
    });
  });

  describe("timeout", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("経過で残りの pending が missing へ移り ready が resolve する", async () => {
      const a = uniqueTag();
      const b = uniqueTag();
      defineTag(a);
      const core = new DefinedCore([a, b], "all", 3000);
      let settled = false;
      core.ready.then(() => { settled = true; });

      expect(core.count).toBe(1);
      expect(core.pending).toEqual([b]);
      expect(settled).toBe(false);

      vi.advanceTimersByTime(3000);
      await flush();

      expect(core.pending).toEqual([]);
      expect(core.missing).toEqual([b]);
      expect(core.defined).toBe(false);
      expect(settled).toBe(true);
      expectInvariant({
        defined: core.defined, pending: core.pending, missing: core.missing,
        count: core.count, total: core.total, error: core.error,
      });
    });

    it("pending が無い状態で timeout が来ても何も起きない（no-op）", async () => {
      const t = uniqueTag();
      defineTag(t);
      const { core, events } = watch();
      core.observe([t], "all", 3000); // 即終端（定義済み）
      const before = events.length;

      vi.advanceTimersByTime(3000);
      await flush();
      expect(events.length).toBe(before);
      expect(core.missing).toEqual([]);
    });
  });

  describe("timeout 後の遅延定義（missing→count 昇格・決定1）", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("missing から count へ昇格し mode=all は defined に昇格する", async () => {
      const t = uniqueTag();
      const core = new DefinedCore([t], "all", 1000);

      vi.advanceTimersByTime(1000);
      await flush();
      expect(core.missing).toEqual([t]);
      expect(core.defined).toBe(false);

      defineTag(t);
      await flush();
      expect(core.missing).toEqual([]);
      expect(core.count).toBe(1);
      expect(core.defined).toBe(true);
      expectInvariant({
        defined: core.defined, pending: core.pending, missing: core.missing,
        count: core.count, total: core.total, error: core.error,
      });
    });
  });

  describe("invalid tag name（決定2）", () => {
    it("error と missing に入り、他の正当なタグの監視は継続する（never-throw）", async () => {
      const good = uniqueTag();
      const bad = "invalidname"; // ハイフン無し = 不正名
      const core = new DefinedCore([good, bad], "all", 0);

      // 初期は両方 pending（reject は microtask 後）
      expect(core.total).toBe(2);
      await flush();

      expect(core.missing).toEqual([bad]);
      expect(core.error).toContain("invalid custom element name: invalidname");
      expect(core.pending).toEqual([good]);
      expect(core.defined).toBe(false);

      // 正当タグは引き続き定義可能
      defineTag(good);
      await flush();
      expect(core.count).toBe(1);
      expect(core.defined).toBe(false); // bad が missing なので all では false
      expectInvariant({
        defined: core.defined, pending: core.pending, missing: core.missing,
        count: core.count, total: core.total, error: core.error,
      });
    });

    it("複数の不正名は error が連結される", async () => {
      const core = new DefinedCore(["nohyphen1", "nohyphen2"], "all", 0);
      await flush();
      expect(core.missing.sort()).toEqual(["nohyphen1", "nohyphen2"]);
      expect(core.error).toContain("nohyphen1");
      expect(core.error).toContain("nohyphen2");
      expect(core.error).toContain(";");
    });

    it("whenDefined が同期 throw する環境でも never-throw（同期で missing+error 化）", () => {
      // 旧仕様/ポリフィルは不正名で whenDefined を同期 throw しうる。happy-dom は
      // rejected promise なので mock で再現し、never-throw 保証が環境非依存なことを示す。
      const t = uniqueTag();
      const spy = vi.spyOn(customElements, "whenDefined").mockImplementation(() => {
        throw new SyntaxError("legacy sync throw");
      });
      let core: DefinedCore;
      expect(() => { core = new DefinedCore([t], "all", 0); }).not.toThrow();
      spy.mockRestore();
      // 同期 throw 経路は init ループ内で処理され、初回 publish 時点で missing+error。
      expect(core!.missing).toEqual([t]);
      expect(core!.error).toContain("invalid custom element name");
      expect(core!.defined).toBe(false);
    });
  });

  describe("空タグ（決定3）", () => {
    it("error をセットし total=0・defined=false で固定する", () => {
      const { core, events } = watch();
      core.observe([], "all", 0);
      expect(core.total).toBe(0);
      expect(core.defined).toBe(false);
      expect(core.error).toBe("no tags specified");
      expect(events).toHaveLength(1);
    });

    it("ready は即 resolve する", async () => {
      const core = new DefinedCore([], "all", 0);
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("世代ガード（dispose / reconnect）", () => {
    it("dispose 後に遅延定義が来ても state は変化しない", async () => {
      const t = uniqueTag();
      const { core, events } = watch();
      core.observe([t], "all", 0);
      const before = events.length;

      core.dispose();
      defineTag(t);
      await flush();

      expect(core.count).toBe(0);
      expect(events.length).toBe(before);
    });

    it("dispose 後に timeout が来ても missing へ移さない", async () => {
      vi.useFakeTimers();
      const t = uniqueTag();
      const core = new DefinedCore([t], "all", 1000);
      core.dispose();

      vi.advanceTimersByTime(1000);
      await flush();
      expect(core.missing).toEqual([]);
      vi.useRealTimers();
    });

    it("dispose→observe で再監視できる", async () => {
      const t = uniqueTag();
      const core = new DefinedCore([t], "all", 0);
      core.dispose();
      core.observe([t], "all", 0);
      defineTag(t);
      await flush();
      expect(core.defined).toBe(true);
    });

    it("subscribe 済みなら observe は再 init せず no-op になる", async () => {
      const a = uniqueTag();
      const b = uniqueTag();
      const core = new DefinedCore([a], "all", 0); // total=1
      core.observe([a, b], "all", 0); // 既に subscribed → 無視（total は 1 のまま）
      expect(core.total).toBe(1);
    });

    it("subscribe 済みでの observe は最初の watch の ready を返す（契約固定）", async () => {
      const a = uniqueTag();
      const b = uniqueTag();
      const core = new DefinedCore([a], "all", 0); // 最初の watch（total=1, a 待ち）
      const firstReady = core.ready;

      // subscribed 済みでの再 observe は no-op。返り値は最初の watch の ready と
      // 同一 Promise でなければならない（b/別 mode を渡しても切り替わらない）。
      const returned = core.observe([b], "any", 5000);
      expect(returned).toBe(firstReady);

      // その ready は「最初の watch」（a の解決）で settle する。b は無関係。
      let settled = false;
      returned.then(() => { settled = true; });
      defineTag(a);
      await flush();
      expect(settled).toBe(true);
      expect(core.total).toBe(1); // 最初の watch のまま
    });

    it("dispose 後に invalid 名の reject が来ても missing へ入れない", async () => {
      const core = new DefinedCore(["nohyphen"], "all", 0);
      core.dispose(); // reject microtask より前に世代を進める
      await flush();
      expect(core.missing).toEqual([]);
      expect(core.error).toBeNull();
    });

    it("pending 中に dispose すると ready が resolve する（hang 防止）", async () => {
      const t = uniqueTag();
      const core = new DefinedCore([t], "all", 0); // timeout 無し → pending のまま
      let settled = false;
      core.ready.then(() => { settled = true; });
      await flush();
      expect(settled).toBe(false);

      core.dispose();
      await flush();
      expect(settled).toBe(true);
    });

    it("observe 前の dispose は安全（ready resolver 不在）", () => {
      const core = new DefinedCore();
      expect(() => core.dispose()).not.toThrow();
    });

    it("timeout 発火後の dispose は安全で、二重 dispose も冪等", async () => {
      vi.useFakeTimers();
      const t = uniqueTag();
      const core = new DefinedCore([t], "all", 1000);

      vi.advanceTimersByTime(1000);
      await flush();
      expect(core.missing).toEqual([t]); // timeout で missing 化済み（終端）

      // 終端後に dispose しても throw せず、状態は据え置き。
      expect(() => core.dispose()).not.toThrow();
      expect(() => core.dispose()).not.toThrow(); // 二重 dispose も no-op
      expect(core.missing).toEqual([t]);
      vi.useRealTimers();
    });

    it("observe 3 回・dispose 2 回を交互に呼んでも冪等で破綻しない", async () => {
      const t = uniqueTag();
      defineTag(t);
      const core = new DefinedCore(); // tags 無しで構築（未 subscribe）

      core.observe([t], "all", 0); // #1 init
      expect(core.defined).toBe(true);
      core.observe([t], "all", 0); // #2 subscribed 済み → no-op
      expect(core.total).toBe(1);

      core.dispose();
      core.dispose(); // 二重 dispose も安全

      core.observe([t], "all", 0); // #3 再 init
      await flush();
      expect(core.defined).toBe(true);
      expect(core.total).toBe(1);
      expectInvariant({
        defined: core.defined, pending: core.pending, missing: core.missing,
        count: core.count, total: core.total, error: core.error,
      });
    });

    it("既定義タグ + 不正名の混在でも不変条件を保つ", async () => {
      const good = uniqueTag();
      defineTag(good); // 接続前に定義済み（同期 count 算入）
      const bad = "noHyphenHere"; // 不正名 → missing + error
      const core = new DefinedCore([good, bad], "all", 0);

      await flush(); // 不正名の reject microtask を処理
      expect(core.count).toBe(1);       // good
      expect(core.missing).toEqual([bad]);
      expect(core.pending).toEqual([]);
      expect(core.defined).toBe(false); // all なので bad が missing の間は false
      expect(core.error).toContain("invalid custom element name");
      expectInvariant({
        defined: core.defined, pending: core.pending, missing: core.missing,
        count: core.count, total: core.total, error: core.error,
      });
    });
  });

  describe("重複タグ名", () => {
    it("不変条件を保ち、全解決で defined になる", async () => {
      const t = uniqueTag();
      const core = new DefinedCore([t, t], "all", 0);
      expect(core.total).toBe(2);
      expect(core.pending).toEqual([t, t]);

      defineTag(t);
      await flush();
      expect(core.count).toBe(2);
      expect(core.pending).toEqual([]);
      expect(core.defined).toBe(true);
      expectInvariant({
        defined: core.defined, pending: core.pending, missing: core.missing,
        count: core.count, total: core.total, error: core.error,
      });
    });

    it("timeout 後に定義されても重複分が両方 missing→count 昇格する", async () => {
      vi.useFakeTimers();
      const t = uniqueTag();
      const core = new DefinedCore([t, t], "all", 1000);
      vi.advanceTimersByTime(1000);
      await flush();
      expect(core.missing).toEqual([t, t]);

      defineTag(t);
      await flush();
      expect(core.count).toBe(2);
      expect(core.missing).toEqual([]);
      expect(core.defined).toBe(true);
      vi.useRealTimers();
    });
  });

  describe("same-value ガード", () => {
    it("同一スナップショットの再 publish は dispatch しない", () => {
      const t = uniqueTag();
      defineTag(t);
      const { core, events } = watch();
      core.observe([t], "all", 0); // publish #1
      expect(events).toHaveLength(1);

      core.dispose();
      core.observe([t], "all", 0); // 同一状態を再現 → 抑制
      expect(events).toHaveLength(1);
    });
  });

  describe("event detail とゲッターの防御コピー", () => {
    it("detail は完全なスナップショット object である", () => {
      const t = uniqueTag();
      defineTag(t);
      const { core, events } = watch();
      core.observe([t], "all", 0);
      expect(events[0]).toEqual({
        defined: true, pending: [], missing: [], count: 1, total: 1, error: null,
      });
    });

    it("ゲッターが返す配列を変更しても内部状態に影響しない", () => {
      const a = uniqueTag();
      const b = uniqueTag();
      const core = new DefinedCore([a, b], "all", 0);
      core.pending.push("x");
      expect(core.pending).toEqual([a, b]);
    });
  });

  describe("wcBindable マニフェスト", () => {
    it("6 プロパティの getter が detail スナップショットから各値を取り出す", () => {
      const byName = (n: string) => DefinedCore.wcBindable.properties.find((p) => p.name === n)!;
      const snap: DefinedSnapshot = {
        defined: true, pending: ["a"], missing: ["b"], count: 2, total: 4, error: "oops",
      };
      const ev = new CustomEvent<DefinedSnapshot>("wcs-defined:change", { detail: snap });
      expect(byName("defined").getter!(ev)).toBe(true);
      expect(byName("pending").getter!(ev)).toEqual(["a"]);
      expect(byName("missing").getter!(ev)).toEqual(["b"]);
      expect(byName("count").getter!(ev)).toBe(2);
      expect(byName("total").getter!(ev)).toBe(4);
      expect(byName("error").getter!(ev)).toBe("oops");
    });

    it("commands は空（event-token 専用ノード）", () => {
      expect(DefinedCore.wcBindable.commands).toEqual([]);
    });
  });

  describe("headless 直接利用", () => {
    it("tags なしで構築すると既定値を返し、publish しない", () => {
      const { core, events } = watch();
      expect(core.defined).toBe(false);
      expect(core.count).toBe(0);
      expect(core.total).toBe(0);
      expect(core.pending).toEqual([]);
      expect(core.error).toBeNull();
      expect(events).toHaveLength(0);
    });
  });
});
