import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ResizeCore } from "../src/core/ResizeCore.js";
import {
  installResizeObserver,
  removeResizeObserver,
  makeEntry,
  size,
  ResizeObserverController,
} from "./mocks.js";

describe("ResizeCore", () => {
  let ctrl: ResizeObserverController;
  let el: Element;

  beforeEach(() => {
    ctrl = installResizeObserver();
    el = document.createElement("div");
  });

  afterEach(() => {
    removeResizeObserver();
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("entry は null、width/height は 0、observing は false", () => {
      const core = new ResizeCore();
      expect(core.entry).toBeNull();
      expect(core.width).toBe(0);
      expect(core.height).toBe(0);
      expect(core.observing).toBe(false);
    });
  });

  describe("observe", () => {
    it("observe で ResizeObserver を生成し対象を監視、observing が true になる", () => {
      const core = new ResizeCore();
      const onObserving = vi.fn();
      core.addEventListener("wcs-resize:observing-changed", onObserving);

      core.observe(el);

      expect(ctrl.instances).toHaveLength(1);
      expect(ctrl.last.observed).toContain(el);
      expect(core.observing).toBe(true);
      expect(onObserving).toHaveBeenCalledOnce();
    });

    it("既定の box（content-box）を observe オプションに渡す", () => {
      const core = new ResizeCore();
      core.observe(el);
      expect(ctrl.last.observedBoxes[0]).toBe("content-box");
    });

    it("指定した box を observe オプションに渡す", () => {
      const core = new ResizeCore();
      core.observe(el, { box: "border-box" });
      expect(ctrl.last.observedBoxes[0]).toBe("border-box");
    });

    it("同一要素・同一オプションでの再 observe は冪等（observer を作り直さない）", () => {
      const core = new ResizeCore();
      core.observe(el);
      core.observe(el);
      expect(ctrl.instances).toHaveLength(1);
    });

    it("別要素を observe すると observer を作り直す", () => {
      const core = new ResizeCore();
      const el2 = document.createElement("div");
      core.observe(el);
      core.observe(el2);
      expect(ctrl.instances).toHaveLength(2);
      expect(ctrl.instances[0].disconnected).toBe(true);
      expect(ctrl.last.observed).toContain(el2);
    });

    it("box / round の変更で observer を作り直す", () => {
      const core = new ResizeCore();
      core.observe(el, { box: "content-box" });
      core.observe(el, { box: "border-box" });
      expect(ctrl.instances).toHaveLength(2);
      core.observe(el, { box: "border-box", round: true });
      expect(ctrl.instances).toHaveLength(3);
      // 同値（round 既定 false）に戻すと再生成
      core.observe(el, { box: "border-box", round: false });
      expect(ctrl.instances).toHaveLength(4);
      // 同値再 observe は冪等
      core.observe(el, { box: "border-box" });
      expect(ctrl.instances).toHaveLength(4);
    });
  });

  describe("change / 派生プロパティ", () => {
    it("リサイズで entry/width/height が更新され wcs-resize:change が発火", () => {
      const core = new ResizeCore();
      const onChange = vi.fn();
      core.addEventListener("wcs-resize:change", onChange);
      core.observe(el);

      ctrl.emit({ contentBoxSize: size(320, 200), contentRect: { width: 320, height: 200 } });

      expect(core.width).toBe(320);
      expect(core.height).toBe(200);
      expect(core.entry?.target).toBe(el);
      expect(core.entry?.contentBoxSize).toEqual({ inlineSize: 320, blockSize: 200 });
      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange.mock.calls[0][0].detail.width).toBe(320);
    });

    it("change は同値ガードせず毎回発火する（イベント性）", () => {
      const core = new ResizeCore();
      const onChange = vi.fn();
      core.addEventListener("wcs-resize:change", onChange);
      core.observe(el);

      ctrl.emit({ contentBoxSize: size(100, 100) });
      ctrl.emit({ contentBoxSize: size(100, 100) });
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it("1コールバックに複数 entries が来てもループ処理し、最後の値が entry に残る", () => {
      // _onResize は entries 配列をループする。単一ターゲット Core では実質1件だが、
      // ループとして書かれている以上、複数 entry を順に処理し change を都度発火して
      // 最後の値が残る挙動を固定する。
      const core = new ResizeCore();
      const onChange = vi.fn();
      core.addEventListener("wcs-resize:change", onChange);
      core.observe(el);

      ctrl.last.emit([
        makeEntry({ target: el, contentBoxSize: size(100, 100) }),
        makeEntry({ target: el, contentBoxSize: size(200, 150) }),
      ]);

      expect(onChange).toHaveBeenCalledTimes(2);
      expect(core.width).toBe(200);
      expect(core.height).toBe(150);
    });

    it("border-box 監視時は borderBoxSize から width/height を導出", () => {
      const core = new ResizeCore();
      core.observe(el, { box: "border-box" });
      ctrl.emit({
        borderBoxSize: size(340, 220),
        contentBoxSize: size(320, 200),
        contentRect: { width: 320, height: 200 },
      });
      expect(core.width).toBe(340);
      expect(core.height).toBe(220);
    });

    it("device-pixel-content-box 監視時は devicePixelContentBoxSize から導出", () => {
      const core = new ResizeCore();
      core.observe(el, { box: "device-pixel-content-box" });
      ctrl.emit({
        devicePixelContentBoxSize: size(640, 400),
        contentBoxSize: size(320, 200),
      });
      expect(core.width).toBe(640);
      expect(core.height).toBe(400);
    });

    it("該当 boxSize が欠如する場合は contentRect にフォールバック", () => {
      const core = new ResizeCore();
      core.observe(el); // content-box
      // contentBoxSize を渡さない（古いエンジン相当）→ contentRect から導出
      ctrl.emit({ contentRect: { width: 256, height: 128 } });
      expect(core.width).toBe(256);
      expect(core.height).toBe(128);
      expect(core.entry?.contentBoxSize).toBeNull();
    });

    it("round=true なら width/height を整数に丸める（boxSize 断片は raw 維持）", () => {
      const core = new ResizeCore();
      core.observe(el, { round: true });
      ctrl.emit({ contentBoxSize: size(99.6, 49.2) });
      expect(core.width).toBe(100);
      expect(core.height).toBe(49);
      // 断片は丸めない
      expect(core.entry?.contentBoxSize).toEqual({ inlineSize: 99.6, blockSize: 49.2 });
    });

    it("round=false（既定）なら width/height は raw 値", () => {
      const core = new ResizeCore();
      core.observe(el);
      ctrl.emit({ contentBoxSize: size(99.6, 49.2) });
      expect(core.width).toBe(99.6);
      expect(core.height).toBe(49.2);
    });
  });

  describe("unobserve / disconnect", () => {
    it("unobserve で監視を解除し observing が false になる", () => {
      const core = new ResizeCore();
      const onObserving = vi.fn();
      core.observe(el);
      core.addEventListener("wcs-resize:observing-changed", onObserving);
      core.unobserve(el);
      expect(core.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
      expect(onObserving).toHaveBeenCalledOnce();
    });

    it("監視中でない要素の unobserve は no-op", () => {
      const core = new ResizeCore();
      const other = document.createElement("div");
      core.observe(el);
      core.unobserve(other);
      expect(core.observing).toBe(true);
      expect(ctrl.last.disconnected).toBe(false);
    });

    it("disconnect で監視を停止し observing が false になる", () => {
      const core = new ResizeCore();
      core.observe(el);
      core.disconnect();
      expect(core.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("observing が同値なら observing-changed を再発火しない", () => {
      const core = new ResizeCore();
      const onObserving = vi.fn();
      core.addEventListener("wcs-resize:observing-changed", onObserving);
      core.disconnect(); // 未監視で disconnect → false のまま
      expect(onObserving).not.toHaveBeenCalled();
    });
  });

  describe("非対応 / 不正 box", () => {
    it("ResizeObserver 不在なら observe は no-op（observing は false）", () => {
      removeResizeObserver();
      const core = new ResizeCore();
      core.observe(el);
      expect(core.observing).toBe(false);
    });

    it("監視中に ResizeObserver 不在で再 observe すると observing が false へ落ちる", () => {
      const core = new ResizeCore();
      core.observe(el);
      expect(core.observing).toBe(true);
      removeResizeObserver();
      core.observe(document.createElement("div"));
      expect(core.observing).toBe(false);
    });

    it("content-box でも observe が throw すれば握り潰して no-op", () => {
      installResizeObserver({ throwBoxes: ["*"] });
      const core = new ResizeCore();
      expect(() => core.observe(el)).not.toThrow();
      expect(core.observing).toBe(false);
    });

    it("非対応 box は content-box にフォールバックして監視を継続し、同じ要求 box の再 observe は冪等", () => {
      // device-pixel-content-box のみ throw → content-box で再試行して成功
      ctrl = installResizeObserver({ throwBoxes: ["device-pixel-content-box"] });
      const core = new ResizeCore();
      core.observe(el, { box: "device-pixel-content-box" });
      expect(core.observing).toBe(true);
      expect(ctrl.instances).toHaveLength(1);
      // 冪等ガードは「要求 box」で比較する。実効 box（content-box）で比較していると、
      // 同じ device-pixel 要求の再 observe が毎回すり抜けて rebuild→throw→fallback を
      // 繰り返す（autoloader upgrade 時の二重 observe で初期通知が重複発火）。要求 box
      // を保持しているので、ここでは observer を作り直さない。
      core.observe(el, { box: "device-pixel-content-box" });
      expect(ctrl.instances).toHaveLength(1);
    });

    it("非対応 box でフォールバックも throw すれば no-op", () => {
      // device-pixel 指定だが全 box throw → 再試行も失敗 → observing false
      installResizeObserver({ throwBoxes: ["*"] });
      const core = new ResizeCore();
      core.observe(el, { box: "device-pixel-content-box" });
      expect(core.observing).toBe(false);
    });
  });

  describe("wcBindable プロパティ getter", () => {
    it("width / height の getter が change イベント detail から値を取り出す", () => {
      const props = ResizeCore.wcBindable.properties;
      const width = props.find((p) => p.name === "width")!;
      const height = props.find((p) => p.name === "height")!;
      // change の detail は正規化済み entry（width/height を持つ）。
      const ev = new CustomEvent("wcs-resize:change", { detail: { width: 123, height: 45 } });
      expect(width.getter!(ev)).toBe(123);
      expect(height.getter!(ev)).toBe(45);
    });
  });

  describe("ライフサイクル（ready / observe() / dispose）", () => {
    it("ready は解決済み Promise を返す（同期準備）", async () => {
      const core = new ResizeCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() を引数なしで呼ぶと no-op で ready を返す（監視は開始しない）", async () => {
      const core = new ResizeCore();
      await expect(core.observe()).resolves.toBeUndefined();
      // 要素を渡していないので observer は生成されない
      expect(ctrl.instances).toHaveLength(0);
      expect(core.observing).toBe(false);
    });

    it("observe(element) は要素監視コマンドに委譲し ready を返す", async () => {
      const core = new ResizeCore();
      await expect(core.observe(el)).resolves.toBeUndefined();
      expect(core.observing).toBe(true);
      expect(ctrl.last.observed).toContain(el);
    });

    it("dispose() は監視を停止し observing を false にする（disconnect と同等）", () => {
      const core = new ResizeCore();
      core.observe(el);
      expect(core.observing).toBe(true);
      core.dispose();
      expect(core.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("dispose() 後に observe(element) で監視を再開できる", () => {
      const core = new ResizeCore();
      core.observe(el);
      core.dispose();
      expect(core.observing).toBe(false);
      core.observe(el);
      expect(core.observing).toBe(true);
    });
  });

  describe("dispatch ターゲット", () => {
    it("コンストラクタに渡した target にイベントを発火する", () => {
      const target = new EventTarget();
      const core = new ResizeCore(target);
      const onChange = vi.fn();
      target.addEventListener("wcs-resize:change", onChange);
      core.observe(el);
      ctrl.emit({ contentBoxSize: size(10, 10) });
      expect(onChange).toHaveBeenCalledOnce();
    });
  });
});
