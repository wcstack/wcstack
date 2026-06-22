import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IntersectionCore } from "../src/core/IntersectionCore.js";
import {
  installIntersectionObserver,
  removeIntersectionObserver,
  makeEntry,
  IntersectionObserverController,
} from "./mocks.js";

describe("IntersectionCore", () => {
  let ctrl: IntersectionObserverController;
  let el: Element;

  beforeEach(() => {
    ctrl = installIntersectionObserver();
    el = document.createElement("div");
  });

  afterEach(() => {
    removeIntersectionObserver();
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("entry は null、intersecting は false、ratio は 0、visible/observing は false", () => {
      const core = new IntersectionCore();
      expect(core.entry).toBeNull();
      expect(core.intersecting).toBe(false);
      expect(core.ratio).toBe(0);
      expect(core.visible).toBe(false);
      expect(core.observing).toBe(false);
    });
  });

  describe("observe", () => {
    it("observe で IntersectionObserver を生成し対象を監視、observing が true になる", () => {
      const core = new IntersectionCore();
      const onObserving = vi.fn();
      core.addEventListener("wcs-intersect:observing-changed", onObserving);

      core.observe(el);

      expect(ctrl.instances).toHaveLength(1);
      expect(ctrl.last.observed).toContain(el);
      expect(core.observing).toBe(true);
      expect(onObserving).toHaveBeenCalledOnce();
    });

    it("同一要素・同一オプションでの再 observe は冪等（observer を作り直さない）", () => {
      const core = new IntersectionCore();
      core.observe(el);
      core.observe(el);
      expect(ctrl.instances).toHaveLength(1);
    });

    it("別要素を observe すると observer を作り直す", () => {
      const core = new IntersectionCore();
      const el2 = document.createElement("div");
      core.observe(el);
      core.observe(el2);
      expect(ctrl.instances).toHaveLength(2);
      expect(ctrl.instances[0].disconnected).toBe(true);
      expect(ctrl.last.observed).toContain(el2);
    });

    it("オプション変更で observer を作り直す（root / rootMargin / threshold それぞれ）", () => {
      const core = new IntersectionCore();
      const root = document.createElement("div");
      core.observe(el, { rootMargin: "0px" });
      core.observe(el, { rootMargin: "10px" });
      expect(ctrl.instances).toHaveLength(2);
      core.observe(el, { rootMargin: "10px", root });
      expect(ctrl.instances).toHaveLength(3);
      core.observe(el, { rootMargin: "10px", root, threshold: 0.5 });
      expect(ctrl.instances).toHaveLength(4);
      core.observe(el, { rootMargin: "10px", root, threshold: [0, 1] });
      expect(ctrl.instances).toHaveLength(5);
    });

    it("threshold が配列でも同値なら冪等", () => {
      const core = new IntersectionCore();
      core.observe(el, { threshold: [0, 0.5, 1] });
      core.observe(el, { threshold: [0, 0.5, 1] });
      expect(ctrl.instances).toHaveLength(1);
    });

    it("生成オプションをネイティブ init に渡す（root=null 既定 / rootMargin / threshold）", () => {
      const core = new IntersectionCore();
      core.observe(el, { rootMargin: "5px", threshold: [0, 1] });
      expect(ctrl.last.options.root).toBeNull();
      expect(ctrl.last.options.rootMargin).toBe("5px");
      expect(ctrl.last.options.threshold).toEqual([0, 1]);
    });
  });

  describe("reobserve", () => {
    it("同一要素・同一オプションでも observer を作り直し、新しいコールバックを出す（冪等回避）", () => {
      const core = new IntersectionCore();
      core.observe(el);
      expect(ctrl.instances).toHaveLength(1);

      core.reobserve(el);
      expect(ctrl.instances).toHaveLength(2);
      expect(ctrl.instances[0].disconnected).toBe(true);
      expect(ctrl.last.observed).toContain(el);

      // 作り直した observer からの交差で change が発火する
      const onChange = vi.fn();
      core.addEventListener("wcs-intersect:change", onChange);
      ctrl.emit({ isIntersecting: true });
      expect(onChange).toHaveBeenCalledOnce();
    });

    it("未監視からの reobserve は単なる observe として機能する", () => {
      const core = new IntersectionCore();
      core.reobserve(el);
      expect(ctrl.instances).toHaveLength(1);
      expect(core.observing).toBe(true);
    });

    it("成功する reobserve は observing を true のまま維持し observing-changed を再発火しない（ブリップしない）", () => {
      const core = new IntersectionCore();
      core.observe(el);
      const onObserving = vi.fn();
      core.addEventListener("wcs-intersect:observing-changed", onObserving);
      core.reobserve(el);
      expect(core.observing).toBe(true);
      expect(onObserving).not.toHaveBeenCalled();
    });
  });

  describe("change / 派生プロパティ", () => {
    it("交差で entry/intersecting/ratio が更新され wcs-intersect:change が発火", () => {
      const core = new IntersectionCore();
      const onChange = vi.fn();
      core.addEventListener("wcs-intersect:change", onChange);
      core.observe(el);

      ctrl.emit({ isIntersecting: true, intersectionRatio: 0.75, time: 123 });

      expect(core.intersecting).toBe(true);
      expect(core.ratio).toBe(0.75);
      expect(core.entry?.time).toBe(123);
      expect(core.entry?.target).toBe(el);
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange.mock.calls[0][0].detail.isIntersecting).toBe(true);
    });

    it("change は同値ガードせず毎回発火する（イベント性）", () => {
      const core = new IntersectionCore();
      const onChange = vi.fn();
      core.addEventListener("wcs-intersect:change", onChange);
      core.observe(el);

      ctrl.emit({ isIntersecting: false });
      ctrl.emit({ isIntersecting: false });
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it("rootBounds が null の entry を正規化できる", () => {
      const core = new IntersectionCore();
      core.observe(el);
      ctrl.emit({ isIntersecting: true, rootBounds: null });
      expect(core.entry?.rootBounds).toBeNull();
    });

    it("rootBounds が存在する entry を plain rect に正規化する", () => {
      const core = new IntersectionCore();
      core.observe(el);
      ctrl.emit({ isIntersecting: true, rootBounds: { width: 100, height: 50 } });
      expect(core.entry?.rootBounds).toMatchObject({ width: 100, height: 50 });
      expect(core.entry?.boundingClientRect).toMatchObject({ x: 0, y: 0 });
    });
  });

  describe("visible ラッチ", () => {
    it("初回交差で visible が true になり visible-changed が発火", () => {
      const core = new IntersectionCore();
      const onVisible = vi.fn();
      core.addEventListener("wcs-intersect:visible-changed", onVisible);
      core.observe(el);

      ctrl.emit({ isIntersecting: true });
      expect(core.visible).toBe(true);
      expect(onVisible).toHaveBeenCalledOnce();
    });

    it("一度 visible になると非交差に戻っても true を維持し再発火しない", () => {
      const core = new IntersectionCore();
      const onVisible = vi.fn();
      core.observe(el);
      ctrl.emit({ isIntersecting: true });
      core.addEventListener("wcs-intersect:visible-changed", onVisible);
      ctrl.emit({ isIntersecting: false });
      ctrl.emit({ isIntersecting: true });
      expect(core.visible).toBe(true);
      expect(onVisible).not.toHaveBeenCalled();
    });

    it("非交差のみでは visible は false のまま", () => {
      const core = new IntersectionCore();
      core.observe(el);
      ctrl.emit({ isIntersecting: false });
      expect(core.visible).toBe(false);
    });

    it("reset で visible ラッチを解除し再度 true にできる", () => {
      const core = new IntersectionCore();
      const onVisible = vi.fn();
      core.observe(el);
      ctrl.emit({ isIntersecting: true });
      core.addEventListener("wcs-intersect:visible-changed", onVisible);

      core.reset();
      expect(core.visible).toBe(false);
      ctrl.emit({ isIntersecting: true });
      expect(core.visible).toBe(true);
      // false への遷移 + 再度 true への遷移で 2 回
      expect(onVisible).toHaveBeenCalledTimes(2);
    });
  });

  describe("unobserve / disconnect", () => {
    it("unobserve で監視を解除し observing が false になる", () => {
      const core = new IntersectionCore();
      const onObserving = vi.fn();
      core.observe(el);
      core.addEventListener("wcs-intersect:observing-changed", onObserving);
      core.unobserve(el);
      expect(core.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
      expect(onObserving).toHaveBeenCalledOnce();
    });

    it("監視中でない要素の unobserve は no-op", () => {
      const core = new IntersectionCore();
      const other = document.createElement("div");
      core.observe(el);
      core.unobserve(other);
      expect(core.observing).toBe(true);
      expect(ctrl.last.disconnected).toBe(false);
    });

    it("disconnect で監視を停止し observing が false になる", () => {
      const core = new IntersectionCore();
      core.observe(el);
      core.disconnect();
      expect(core.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("observing が同値なら observing-changed を再発火しない", () => {
      const core = new IntersectionCore();
      const onObserving = vi.fn();
      core.addEventListener("wcs-intersect:observing-changed", onObserving);
      core.disconnect(); // 未監視で disconnect → false のまま
      expect(onObserving).not.toHaveBeenCalled();
    });
  });

  describe("非対応 / 不正オプション", () => {
    it("IntersectionObserver 不在なら observe は no-op（observing は false）", () => {
      removeIntersectionObserver();
      const core = new IntersectionCore();
      core.observe(el);
      expect(core.observing).toBe(false);
    });

    it("不正オプションでコンストラクタが throw しても握り潰して no-op", () => {
      installIntersectionObserver({ throwOnConstruct: true });
      const core = new IntersectionCore();
      expect(() => core.observe(el, { rootMargin: "bad" })).not.toThrow();
      expect(core.observing).toBe(false);
    });

    it("監視中に不正オプションで再 observe すると observer 喪失に合わせ observing が false になる", () => {
      // 監視中（observing=true）の状態から、新オプションでコンストラクタが throw する
      // ように差し替えると、teardown 後に observer 生成が失敗する。このとき observing が
      // true のまま残らず false へ落ちる（observer 実体なしとの不整合を防ぐ）ことを確認。
      const core = new IntersectionCore();
      core.observe(el);
      expect(core.observing).toBe(true);

      installIntersectionObserver({ throwOnConstruct: true });
      core.observe(el, { rootMargin: "bad" });
      expect(core.observing).toBe(false);
    });
  });

  describe("ライフサイクル: ready / observe 戻り値 / dispose", () => {
    it("ready は即時解決する（同期セットアップ、非同期プローブ無し）", async () => {
      const core = new IntersectionCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe は ready（即時解決の promise）を返す", async () => {
      const core = new IntersectionCore();
      await expect(core.observe(el)).resolves.toBeUndefined();
    });

    it("冪等な再 observe（同一対象・同一オプション）も ready を返す", async () => {
      const core = new IntersectionCore();
      core.observe(el);
      await expect(core.observe(el)).resolves.toBeUndefined();
    });

    it("生成失敗（非対応環境）でも observe は ready を返す", async () => {
      removeIntersectionObserver();
      const core = new IntersectionCore();
      await expect(core.observe(el)).resolves.toBeUndefined();
      expect(core.observing).toBe(false);
    });

    it("dispose で監視を停止し observing が false になる", () => {
      const core = new IntersectionCore();
      core.observe(el);
      expect(core.observing).toBe(true);
      core.dispose();
      expect(core.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("dispose 後に届いた古い observer のコールバックは状態を変えない（_gen ガード）", () => {
      const core = new IntersectionCore();
      core.observe(el);
      const stale = ctrl.last; // dispose 前の observer を保持
      core.dispose();
      // 切断後に古い observer が交差を遅延配信しても entry/visible は変わらない。
      stale.emit([makeEntry({ isIntersecting: true, intersectionRatio: 1, target: el })]);
      expect(core.entry).toBeNull();
      expect(core.visible).toBe(false);
    });

    it("別オプションで作り直す前の observer のコールバックは破棄される（stale-gen 分岐）", () => {
      const core = new IntersectionCore();
      core.observe(el, { rootMargin: "0px" });
      const stale = ctrl.instances[0];
      core.observe(el, { rootMargin: "10px" }); // teardown+rebuild で _gen を進める
      // 古い observer からの配信は現世代と一致せず破棄される。
      stale.emit([makeEntry({ isIntersecting: true, target: el })]);
      expect(core.entry).toBeNull();
      expect(core.visible).toBe(false);
      // 新しい observer からの配信は反映される（現世代）。
      ctrl.last.emit([makeEntry({ isIntersecting: true, target: el })]);
      expect(core.entry).not.toBeNull();
      expect(core.visible).toBe(true);
    });

    it("dispose 後に observe で監視を再開できる（復活）", () => {
      const core = new IntersectionCore();
      core.observe(el);
      core.dispose();
      expect(core.observing).toBe(false);
      core.observe(el);
      expect(core.observing).toBe(true);
      ctrl.last.emit([makeEntry({ isIntersecting: true, target: el })]);
      expect(core.intersecting).toBe(true);
    });
  });

  describe("wcBindable プロパティ getter", () => {
    it("intersecting / ratio の getter が change イベントから値を取り出す", () => {
      const props = IntersectionCore.wcBindable.properties;
      const intersecting = props.find((p) => p.name === "intersecting")!;
      const ratio = props.find((p) => p.name === "ratio")!;
      const ev = new CustomEvent("wcs-intersect:change", {
        detail: makeEntry({ isIntersecting: true, intersectionRatio: 0.42 }),
      });
      expect(intersecting.getter!(ev)).toBe(true);
      expect(ratio.getter!(ev)).toBe(0.42);
    });
  });

  describe("dispatch ターゲット", () => {
    it("コンストラクタに渡した target にイベントを発火する", () => {
      const target = new EventTarget();
      const core = new IntersectionCore(target);
      const onChange = vi.fn();
      target.addEventListener("wcs-intersect:change", onChange);
      core.observe(el);
      ctrl.emit({ isIntersecting: true });
      expect(onChange).toHaveBeenCalledOnce();
    });
  });
});
