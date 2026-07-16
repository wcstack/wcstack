import { describe, it, expect, afterEach, vi } from "vitest";
import { FullscreenCore } from "../src/core/FullscreenCore";
import {
  stubRequestFullscreen,
  stubRequestFullscreenOnElementPrototype,
  stubExitFullscreen,
  removeRequestFullscreen,
  removeExitFullscreen,
  setFullscreenElement,
  clearFullscreenElement,
  dispatchFullscreenChange,
  resetFullscreenEnvironment,
  withoutOnfullscreenchange,
} from "./mocks";

describe("FullscreenCore", () => {
  afterEach(() => {
    resetFullscreenEnvironment();
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("active/error は既定値", () => {
      const core = new FullscreenCore();
      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new FullscreenCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("wcBindable プロトコル宣言", () => {
    it("properties に active / error / errorInfo、active getter が detail.active を取り出す", () => {
      expect(FullscreenCore.wcBindable.properties).toHaveLength(3);
      const names = FullscreenCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["active", "error", "errorInfo"]);
      const prop = FullscreenCore.wcBindable.properties[0];
      expect(prop.name).toBe("active");
      expect(prop.event).toBe("wcs-fullscreen:change");
      const ev = new CustomEvent("wcs-fullscreen:change", { detail: { active: true } });
      expect(prop.getter!(ev)).toBe(true);
      // error / errorInfo は observable な失敗出力(event 付き)。
      expect(FullscreenCore.wcBindable.properties[1]).toEqual({ name: "error", event: "wcs-fullscreen:error" });
      expect(FullscreenCore.wcBindable.properties[2]).toEqual({ name: "errorInfo", event: "wcs-fullscreen:error-info-changed" });
    });

    it("commands に requestFullscreen/exitFullscreen が async 宣言される", () => {
      const commands = FullscreenCore.wcBindable.commands!;
      expect(commands).toEqual([
        { name: "requestFullscreen", async: true },
        { name: "exitFullscreen", async: true },
      ]);
    });
  });

  describe("errorInfo taxonomy (Phase 6)", () => {
    it("初期状態の errorInfo は null", () => {
      expect(new FullscreenCore().errorInfo).toBeNull();
    });

    it("target 未解決 → invalid-argument / start / recoverable=false", async () => {
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(null);
      expect(core.errorInfo).toEqual({
        code: "invalid-argument", phase: "start", recoverable: false,
        message: "Fullscreen target could not be resolved.",
      });
    });

    it("unsupported → capability-missing / probe / recoverable=false", async () => {
      const el = document.createElement("div");
      removeRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "probe", recoverable: false,
        message: "Fullscreen API is not supported.",
      });
    });

    it("TypeError(gesture 外)→ not-allowed / execute / recoverable=true", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el, { rejectWith: new TypeError("needs a user gesture") });
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.errorInfo).toEqual({ code: "not-allowed", phase: "execute", recoverable: true, message: "needs a user gesture" });
    });

    it("NotAllowedError → not-allowed / execute / recoverable=true", async () => {
      const el = document.createElement("div");
      const err = new Error("denied"); err.name = "NotAllowedError";
      stubRequestFullscreen(el, { rejectWith: err });
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.errorInfo).toEqual({ code: "not-allowed", phase: "execute", recoverable: true, message: "denied" });
    });

    it("その他 caught 例外 → fullscreen-error / execute / recoverable=false", async () => {
      const el = document.createElement("div");
      const err = new Error("boom"); err.name = "InvalidStateError";
      stubRequestFullscreen(el, { rejectWith: err });
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.errorInfo).toEqual({ code: "fullscreen-error", phase: "execute", recoverable: false, message: "boom" });
    });

    it("非 Error(message 非 string)の reject も never-throw で fullscreen-error に分類", async () => {
      const el = document.createElement("div");
      // string を throw: .message を持たないので messageOf は String(error) にフォールバック。
      stubRequestFullscreen(el, { rejectWith: "raw failure" as unknown as Error });
      const core = new FullscreenCore();
      core.observe();
      await expect(core.requestFullscreen(el)).resolves.toBeUndefined();
      expect(core.errorInfo).toEqual({ code: "fullscreen-error", phase: "execute", recoverable: false, message: "raw failure" });
    });

    it("成功で errorInfo が null にクリアされ、error と同期する", async () => {
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(null); // まず error を立てる
      expect(core.errorInfo).not.toBeNull();
      const el = document.createElement("div");
      stubRequestFullscreen(el, {});
      await core.requestFullscreen(el);
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("wcs-fullscreen:error-info-changed が error より前に発火する", async () => {
      const core = new FullscreenCore();
      const order: string[] = [];
      core.addEventListener("wcs-fullscreen:error-info-changed", () => order.push("errorInfo"));
      core.addEventListener("wcs-fullscreen:error", () => order.push("error"));
      core.observe();
      await core.requestFullscreen(null);
      expect(order).toEqual(["errorInfo", "error"]);
    });
  });

  describe("requestFullscreen() — 成功", () => {
    it("成功時に fullscreenchange 経由で active: true になる", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      const events: any[] = [];
      core.addEventListener("wcs-fullscreen:change", (e) => events.push((e as CustomEvent).detail));

      await core.requestFullscreen(el);

      expect(core.active).toBe(true);
      expect(core.error).toBeNull();
      expect(events).toEqual([{ active: true }]);
    });

    it("target を渡すとそこへ change を dispatch する", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const target = new EventTarget();
      const events: any[] = [];
      target.addEventListener("wcs-fullscreen:change", (e) => events.push((e as CustomEvent).detail));

      const core = new FullscreenCore(target);
      core.observe();
      await core.requestFullscreen(el);

      expect(events).toEqual([{ active: true }]);
    });

    it("error が立った状態から成功すると error が null に戻る", async () => {
      // README の契約 "null if the last attempt succeeded" の直接検証。
      // 他の成功テストは error が最初から null のため、成功パスの
      // _setError(null) を削除しても検出できない（弱アサート）——先に error を
      // 立ててから成功させ、クリアの効果そのものを検証する。
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(null); // target 未解決で error を立てる
      expect(core.error).toEqual({ message: "Fullscreen target could not be resolved." });

      await core.requestFullscreen(el);

      expect(core.error).toBeNull();
      expect(core.active).toBe(true);
    });
  });

  describe("requestFullscreen() — gesture 外呼び出し想定の reject", () => {
    it("TypeError で reject しても never-throw で error に格納する", async () => {
      // WHATWG Fullscreen 仕様の fullscreen element ready check は、transient
      // activation (user gesture) が無い場合 TypeError で reject する
      // (https://fullscreen.spec.whatwg.org/) — NotAllowedError ではない。
      const el = document.createElement("div");
      const gestureError = new TypeError(
        "Failed to execute 'requestFullscreen' on 'Element': API can only be initiated by a user gesture.",
      );
      stubRequestFullscreen(el, { rejectWith: gestureError });
      const core = new FullscreenCore();
      core.observe();

      await expect(core.requestFullscreen(el)).resolves.toBeUndefined();

      expect(core.error).toBe(gestureError);
      expect(core.active).toBe(false);
    });
  });

  describe("requestFullscreen() — unsupported", () => {
    it("標準 API・レガシー API ともに無い場合は error へ落ちる", async () => {
      const el = document.createElement("div");
      removeRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();

      await core.requestFullscreen(el);

      expect(core.error).toEqual({ message: "Fullscreen API is not supported." });
      expect(core.active).toBe(false);
    });
  });

  describe("requestFullscreen() — target 未解決（null）", () => {
    it("「API 未対応」とは別のメッセージで error へ落ちる", async () => {
      const core = new FullscreenCore();
      core.observe();

      await core.requestFullscreen(null);

      expect(core.error).toEqual({ message: "Fullscreen target could not be resolved." });
      expect(core.active).toBe(false);
    });
  });

  describe("requestFullscreen() — レガシー API のみ存在", () => {
    it("webkitRequestFullscreen のみでも解決できる", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el, { legacy: true });
      const core = new FullscreenCore();
      core.observe();

      await core.requestFullscreen(el);

      expect(core.active).toBe(true);
      expect(core.error).toBeNull();
    });
  });

  describe("requestFullscreen() — API 解決のシャドウ回避（Element.prototype 直参照）", () => {
    it("Element.prototype の標準 API で解決できる（実ブラウザ相当の配置）", async () => {
      const restore = stubRequestFullscreenOnElementPrototype();
      try {
        const el = document.createElement("div");
        const core = new FullscreenCore();
        core.observe();

        await core.requestFullscreen(el);

        expect(core.active).toBe(true);
        expect(core.error).toBeNull();
      } finally {
        restore();
      }
    });

    it("Element.prototype のレガシー API のみでも解決できる（対称性）", async () => {
      const restore = stubRequestFullscreenOnElementPrototype({ legacy: true });
      try {
        const el = document.createElement("div");
        const core = new FullscreenCore();
        core.observe();

        await core.requestFullscreen(el);

        expect(core.active).toBe(true);
        expect(core.error).toBeNull();
      } finally {
        restore();
      }
    });

    it("サブクラスが同名メソッドを定義していても Element.prototype の API を呼ぶ（シャドウさせない）", async () => {
      // <wcs-fullscreen> 自身が requestFullscreen() コマンドメソッドを持つため、
      // 素の el.requestFullscreen 参照はサブクラスのメソッドを拾って無限再帰する
      // （target="self" のスタックオーバーフロー回帰）。Core はサブクラスの
      // prototype を飛ばして Element.prototype を直接参照しなければならない。
      class ShadowingElement extends HTMLElement {
        subclassCalled = false;
        async requestFullscreen(): Promise<void> {
          this.subclassCalled = true;
          throw new Error("subclass command method must not be invoked by the Core");
        }
      }
      if (!customElements.get("test-shadowing-element")) {
        customElements.define("test-shadowing-element", ShadowingElement);
      }
      const restore = stubRequestFullscreenOnElementPrototype();
      try {
        const el = document.createElement("test-shadowing-element") as ShadowingElement;
        const core = new FullscreenCore();
        core.observe();

        await core.requestFullscreen(el);

        expect(el.subclassCalled).toBe(false);
        expect(core.active).toBe(true);
        expect(core.error).toBeNull();
      } finally {
        restore();
      }
    });

    it("インスタンス own property のスタブは Element.prototype より優先される", async () => {
      // テスト・意図的な要素単位のモンキーパッチは own property として現れる。
      // own → Element.prototype の順で解決することを確認する。
      const restore = stubRequestFullscreenOnElementPrototype({
        rejectWith: new Error("prototype stub must not win over an own property"),
      });
      try {
        const el = document.createElement("div");
        stubRequestFullscreen(el); // own property
        const core = new FullscreenCore();
        core.observe();

        await core.requestFullscreen(el);

        expect(core.active).toBe(true);
        expect(core.error).toBeNull();
      } finally {
        restore();
      }
    });
  });

  describe("複数インスタンス同時存在（§2.1 MUST）", () => {
    it("#a が fullscreen 化された場合、#a を target にしたインスタンスのみ active: true になる", async () => {
      const a = document.createElement("div");
      a.id = "a";
      const b = document.createElement("div");
      b.id = "b";
      stubRequestFullscreen(a);

      const coreA = new FullscreenCore();
      const coreB = new FullscreenCore();
      coreA.observe();
      coreB.observe();
      coreB.setTarget(b);

      await coreA.requestFullscreen(a);

      expect(coreA.active).toBe(true);
      expect(coreB.active).toBe(false);
    });

    it("同一 fullscreenchange を両方が受信しても、targetが一致するインスタンスだけが active になる", async () => {
      const a = document.createElement("div");
      const b = document.createElement("div");
      stubRequestFullscreen(a);

      const coreA = new FullscreenCore();
      const coreB = new FullscreenCore();
      coreA.observe();
      coreB.observe();
      coreA.setTarget(a);
      coreB.setTarget(b);

      // fullscreenchange は document 単位のイベント。両方の Core が同じイベントを
      // 受信することを、直接 dispatch して検証する。
      setFullscreenElement(a);
      dispatchFullscreenChange();

      expect(coreA.active).toBe(true);
      expect(coreB.active).toBe(false);
    });
  });

  describe("exitFullscreen() — 何もfullscreenでない状態", () => {
    it("silent no-op（error が立たず例外も出ない）", async () => {
      clearFullscreenElement();
      const core = new FullscreenCore();
      core.observe();

      await expect(core.exitFullscreen()).resolves.toBeUndefined();

      expect(core.error).toBeNull();
      expect(core.active).toBe(false);
    });

    it("unsupported（exitFullscreen も webkitExitFullscreen も無い）でも silent no-op", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      removeExitFullscreen();
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.active).toBe(true);

      await expect(core.exitFullscreen()).resolves.toBeUndefined();

      expect(core.error).toBeNull();
    });
  });

  describe("exitFullscreen() — 成功", () => {
    it("成功時に fullscreenchange 経由で active: false になる", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      stubExitFullscreen();
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.active).toBe(true);

      await core.exitFullscreen();

      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("レガシー webkitExitFullscreen のみでも解決できる", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el, { legacy: true });
      stubExitFullscreen({ legacy: true });
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.active).toBe(true);

      await core.exitFullscreen();

      expect(core.active).toBe(false);
    });

    it("error が立った状態から exitFullscreen() が成功すると error が null に戻る", async () => {
      // requestFullscreen() 側の同名テストと対になる、exit 成功パスの
      // _setError(null) の効果検証。reject する exit で error を立ててから、
      // 成功する exit でクリアされることを確認する。
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);
      expect(core.active).toBe(true);

      const failure = new Error("exit failed");
      stubExitFullscreen({ rejectWith: failure });
      await core.exitFullscreen();
      expect(core.error).toBe(failure); // error が立っている

      stubExitFullscreen(); // 成功する exit に差し替え
      await core.exitFullscreen();

      expect(core.error).toBeNull();
      expect(core.active).toBe(false);
    });
  });

  describe("exitFullscreen() — reject", () => {
    it("reject しても never-throw で error に格納する", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const failure = new Error("exit failed");
      stubExitFullscreen({ rejectWith: failure });
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);

      await expect(core.exitFullscreen()).resolves.toBeUndefined();

      expect(core.error).toBe(failure);
    });
  });

  describe("_gen 世代ガード", () => {
    it("dispose 後に requestFullscreen() の Promise が resolve しても状態を書き換えない", async () => {
      const el = document.createElement("div");
      let resolveFn: (() => void) | undefined;
      (el as any).requestFullscreen = () => new Promise<void>((resolve) => { resolveFn = resolve; });
      const core = new FullscreenCore();
      core.observe();

      const p = core.requestFullscreen(el);
      core.dispose();
      setFullscreenElement(el);
      resolveFn!();
      await p;

      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("dispose 後に requestFullscreen() の Promise が reject しても状態を書き換えない", async () => {
      const el = document.createElement("div");
      let rejectFn: ((e: any) => void) | undefined;
      (el as any).requestFullscreen = () => new Promise<void>((_resolve, reject) => { rejectFn = reject; });
      const core = new FullscreenCore();
      core.observe();

      const p = core.requestFullscreen(el);
      core.dispose();
      rejectFn!(new Error("late failure"));
      await p;

      expect(core.error).toBeNull();
    });

    it("進行中の requestFullscreen() を no-op の exitFullscreen() が追い越さない（error が握り潰されない）", async () => {
      // 何も fullscreen でない状態での exitFullscreen() は silent no-op であり、
      // 世代を進めてはならない。進めてしまうと、pending 中の request が
      // reject したとき stale 扱いになり error が観測できなくなる。
      const el = document.createElement("div");
      let rejectFn: ((e: any) => void) | undefined;
      (el as any).requestFullscreen = () => new Promise<void>((_resolve, reject) => { rejectFn = reject; });
      const core = new FullscreenCore();
      core.observe();
      clearFullscreenElement();

      const p = core.requestFullscreen(el);
      await core.exitFullscreen(); // no-op: 何も fullscreen ではない
      const failure = new TypeError("gesture rejected");
      rejectFn!(failure);
      await p;

      expect(core.error).toBe(failure);
    });

    it("dispose 後に exitFullscreen() の Promise が resolve しても状態を書き換えない", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);

      let resolveFn: (() => void) | undefined;
      (document as any).exitFullscreen = () => new Promise<void>((resolve) => { resolveFn = resolve; });

      const p = core.exitFullscreen();
      core.dispose();
      clearFullscreenElement();
      resolveFn!();
      await p;

      // dispose() 後は active の書き換えが起きない = fullscreenchange リスナーも
      // 解除済みなので直前の true のままであることを確認する。
      expect(core.active).toBe(true);
    });

    it("dispose 後に exitFullscreen() の Promise が reject しても状態を書き換えない", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      await core.requestFullscreen(el);

      let rejectFn: ((e: any) => void) | undefined;
      (document as any).exitFullscreen = () => new Promise<void>((_resolve, reject) => { rejectFn = reject; });

      const p = core.exitFullscreen();
      core.dispose();
      rejectFn!(new Error("late exit failure"));
      await p;

      // stale gen のため error は書き換えられない。
      expect(core.error).toBeNull();
    });
  });

  describe("observe()/dispose() の冪等性", () => {
    it("observe() の二重呼び出しでリスナーが二重登録されない", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const addSpy = vi.spyOn(document, "addEventListener");
      const core = new FullscreenCore();

      core.observe();
      core.observe();

      const fullscreenCalls = addSpy.mock.calls.filter((c) => c[0] === "fullscreenchange");
      expect(fullscreenCalls).toHaveLength(1);
    });

    it("dispose 後の再 observe でリスナーが復活する", async () => {
      const el = document.createElement("div");
      stubRequestFullscreen(el);
      const core = new FullscreenCore();
      core.observe();
      core.dispose();
      core.observe();

      await core.requestFullscreen(el);

      expect(core.active).toBe(true);
    });

    it("一度も observe していない dispose は安全な no-op", () => {
      const core = new FullscreenCore();
      expect(() => core.dispose()).not.toThrow();
    });

    it("dispose の二重呼び出しでリスナー解除も二重に行われない", () => {
      const removeSpy = vi.spyOn(document, "removeEventListener");
      const core = new FullscreenCore();
      core.observe();
      core.dispose();
      core.dispose();

      const fullscreenCalls = removeSpy.mock.calls.filter((c) => c[0] === "fullscreenchange");
      expect(fullscreenCalls).toHaveLength(1);
    });
  });

  describe("setTarget()", () => {
    it("target 未解決（null）の場合は active が常に false", () => {
      const core = new FullscreenCore();
      core.observe();
      core.setTarget(null);
      setFullscreenElement(document.createElement("div"));

      // setTarget(null) 自体は fullscreenElement と比較しても一致しないため false のまま。
      expect(core.active).toBe(false);
    });

    it("setTarget で target を変更すると現在の fullscreenElement と再評価される", () => {
      const a = document.createElement("div");
      const b = document.createElement("div");
      setFullscreenElement(a);
      const core = new FullscreenCore();
      core.observe();

      core.setTarget(a);
      expect(core.active).toBe(true);

      core.setTarget(b);
      expect(core.active).toBe(false);
    });

    it("同値の active では change イベントが再発火しない（同値ガード）", () => {
      const a = document.createElement("div");
      setFullscreenElement(a);
      const core = new FullscreenCore();
      core.observe();
      core.setTarget(a);
      expect(core.active).toBe(true);

      const events: any[] = [];
      core.addEventListener("wcs-fullscreen:change", (e) => events.push((e as CustomEvent).detail));
      core.setTarget(a);

      expect(events).toEqual([]);
    });
  });

  describe("_fullscreenChangeEventName() — レガシー環境（onfullscreenchange 不在）", () => {
    it("標準の onfullscreenchange が無ければ webkitfullscreenchange を購読する", async () => {
      // "onfullscreenchange" は happy-dom のプロトタイプチェーン上にある own
      // property なので、document 自身に defineProperty しても `in` 演算子の
      // 判定は変わらない。withoutOnfullscreenchange ヘルパがプロトタイプ
      // チェーンを遡って所有者から一時的に削除し、finally で必ず復元する。
      await withoutOnfullscreenchange(async () => {
        expect("onfullscreenchange" in document).toBe(false);

        const el = document.createElement("div");
        stubRequestFullscreen(el, { legacy: true });
        const addSpy = vi.spyOn(document, "addEventListener");
        const core = new FullscreenCore();

        core.observe();

        expect(addSpy).toHaveBeenCalledWith("webkitfullscreenchange", expect.any(Function));

        await core.requestFullscreen(el);
        expect(core.active).toBe(true);

        core.dispose();
        const removeSpy = vi.spyOn(document, "removeEventListener");
        core.observe();
        core.dispose();
        expect(removeSpy).toHaveBeenCalledWith("webkitfullscreenchange", expect.any(Function));
      });
      // ヘルパの finally が復元済みであることを確認する。
      expect("onfullscreenchange" in document).toBe(true);
    });
  });
});
