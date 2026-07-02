import { describe, it, expect, afterEach, vi } from "vitest";
import { PointerLockCore } from "../src/core/PointerLockCore";
import { installPointerLockDoc, removePointerLockDoc } from "./mocks";

function makeElement(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("PointerLockCore", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    removePointerLockDoc();
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("observe 前は active=false, error=null", () => {
      const core = new PointerLockCore();
      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new PointerLockCore();
      await expect(core.ready).resolves.toBeUndefined();
    });
  });

  describe("requestPointerLock() 成功", () => {
    it("成功時に pointerlockchange 経由で active: true になる", async () => {
      installPointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();
      const events: any[] = [];
      core.addEventListener("wcs-pointer-lock:change", (e) => events.push((e as CustomEvent).detail));

      await core.requestPointerLock(el);

      expect(core.active).toBe(true);
      expect(core.error).toBeNull();
      expect(events).toEqual([true]);
    });

    it("target に指定した EventTarget から change イベントが dispatch される", async () => {
      installPointerLockDoc();
      const el = makeElement();
      const target = new EventTarget();
      const events: any[] = [];
      target.addEventListener("wcs-pointer-lock:change", (e) => events.push((e as CustomEvent).detail));

      const core = new PointerLockCore(target);
      await core.requestPointerLock(el);

      expect(events).toEqual([true]);
    });
  });

  describe("requestPointerLock() — user gesture 制約 (reject)", () => {
    it("NotAllowedError の reject を never-throw で catch し error に格納する", async () => {
      installPointerLockDoc({}, function () {
        return Promise.reject(new DOMException("gesture required", "NotAllowedError"));
      });
      const el = makeElement();
      const core = new PointerLockCore();

      await expect(core.requestPointerLock(el)).resolves.toBeUndefined();

      expect(core.active).toBe(false);
      expect(core.error).toBeInstanceOf(DOMException);
      expect(core.error.name).toBe("NotAllowedError");
    });
  });

  describe("requestPointerLock() — API 解決", () => {
    it("標準 API 不在・レガシー(webkitRequestPointerLock)のみ存在でも動作する", async () => {
      installPointerLockDoc({ standard: false, legacy: true });
      const el = makeElement();
      const core = new PointerLockCore();

      await core.requestPointerLock(el);

      expect(core.active).toBe(true);
      expect(core.error).toBeNull();
    });

    it("unsupported 環境（requestPointerLock も webkitRequestPointerLock も無い）で error に落ちる", async () => {
      removePointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();

      await core.requestPointerLock(el);

      expect(core.active).toBe(false);
      expect(core.error).toEqual({ message: "Pointer Lock API is not supported." });
    });
  });

  describe('target="self" 相当: Shell と同名のコマンドを持つ要素でも衝突しない', () => {
    it("要素が独自の requestPointerLock メソッドを持っていても never-throw で正しく解決される（無限再帰しない）", async () => {
      installPointerLockDoc();
      const el = makeElement() as any;
      // Simulate the Shell's own `requestPointerLock()` instance method
      // shadowing the platform API on the element itself (docs/pointer-lock-tag-design.md
      // §1 / the `target="self"` case where `el` is the `<wcs-pointer-lock>`
      // Shell, whose class also declares a same-named command method).
      el.requestPointerLock = () => {
        throw new Error("should never be called — Core must resolve via Element.prototype");
      };
      const core = new PointerLockCore();

      await expect(core.requestPointerLock(el)).resolves.toBeUndefined();

      expect(core.active).toBe(true);
      expect(core.error).toBeNull();
    });
  });

  describe("複数インスタンス同時存在", () => {
    it("#a と #b をtargetにした2インスタンスが同一 pointerlockchange を受けても正しく分離される", async () => {
      const doc = installPointerLockDoc();
      const elA = makeElement();
      elA.id = "a";
      const elB = makeElement();
      elB.id = "b";

      const coreA = new PointerLockCore();
      const coreB = new PointerLockCore();
      coreA.observe(elA);
      coreB.observe(elB);

      // #a がロックされる
      doc.setLockedElement(elA);
      expect(coreA.active).toBe(true);
      expect(coreB.active).toBe(false);

      // #b がロックされる（#a は自動的に unlock された扱いになる）
      doc.setLockedElement(elB);
      expect(coreA.active).toBe(false);
      expect(coreB.active).toBe(true);
    });
  });

  describe("exitPointerLock()", () => {
    it("ロック中に呼ぶと active: false になる", async () => {
      installPointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();
      await core.requestPointerLock(el);
      expect(core.active).toBe(true);

      core.exitPointerLock();

      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("何もロックされていない状態での呼び出しは silent no-op（error も立たず例外も出ない）", () => {
      installPointerLockDoc();
      const core = new PointerLockCore();

      expect(() => core.exitPointerLock()).not.toThrow();
      expect(core.error).toBeNull();
      expect(core.active).toBe(false);
    });

    it("unsupported 環境での呼び出しも silent no-op", () => {
      removePointerLockDoc();
      const core = new PointerLockCore();

      expect(() => core.exitPointerLock()).not.toThrow();
      expect(core.error).toBeNull();
    });

    it("同期例外を投げる偽実装でも never-throw が保たれ、error に格納される", async () => {
      installPointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();
      await core.requestPointerLock(el);

      Object.defineProperty(document, "exitPointerLock", {
        value: () => {
          throw new Error("boom");
        },
        configurable: true,
        writable: true,
      });

      expect(() => core.exitPointerLock()).not.toThrow();
      expect(core.error).toBeInstanceOf(Error);
      expect((core.error as Error).message).toBe("boom");
    });

    it("レガシー(webkitExitPointerLock)のみ存在でも動作する", async () => {
      installPointerLockDoc({ standard: false, legacy: true });
      const el = makeElement();
      const core = new PointerLockCore();
      await core.requestPointerLock(el);
      expect(core.active).toBe(true);

      core.exitPointerLock();

      expect(core.active).toBe(false);
    });

    it("何かロック中だが exit 関数が両名とも存在しない場合は silent no-op", () => {
      installPointerLockDoc();
      const el = makeElement();
      // pointerLockElement は非 null を返すが、exitPointerLock/webkitExitPointerLock
      // をどちらも取り除いた状態を作る (156行目の unsupported 分岐を踏む)。
      Object.defineProperty(document, "pointerLockElement", {
        get: () => el,
        configurable: true,
      });
      if (Object.prototype.hasOwnProperty.call(document, "exitPointerLock")) {
        delete (document as any).exitPointerLock;
      }
      if (Object.prototype.hasOwnProperty.call(document, "webkitExitPointerLock")) {
        delete (document as any).webkitExitPointerLock;
      }
      const core = new PointerLockCore();

      expect(() => core.exitPointerLock()).not.toThrow();
      expect(core.error).toBeNull();
    });
  });

  // Note: `_pointerLockChangeEventName()` picks the legacy `webkitpointerlockchange`
  // name only when `"onpointerlockchange" in document` is false. happy-dom's
  // `Document` always exposes an `onpointerlockchange` handler property (like
  // `onclick` et al.) regardless of installed stubs, so that branch cannot be
  // exercised under this test environment — this mirrors the same limitation
  // documented for FullscreenCore's `_fullscreenChangeEventName()`.

  describe("_gen 世代ガード", () => {
    it("dispose 後に requestPointerLock() の Promise が resolve しても状態を書き換えない", async () => {
      let resolveFn!: () => void;
      installPointerLockDoc({}, function () {
        return new Promise<void>((resolve) => {
          resolveFn = resolve;
        });
      });
      const el = makeElement();
      const core = new PointerLockCore();

      const p = core.requestPointerLock(el);
      core.dispose();
      resolveFn();
      await p;

      expect(core.active).toBe(false);
      expect(core.error).toBeNull();
    });

    it("dispose 後に requestPointerLock() の Promise が reject しても状態を書き換えない", async () => {
      let rejectFn!: (e: unknown) => void;
      installPointerLockDoc({}, function () {
        return new Promise<void>((_resolve, reject) => {
          rejectFn = reject;
        });
      });
      const el = makeElement();
      const core = new PointerLockCore();

      const p = core.requestPointerLock(el);
      core.dispose();
      rejectFn(new Error("stale"));
      await p;

      expect(core.error).toBeNull();
    });
  });

  describe("observe()/dispose() の冪等性", () => {
    it("observe() の二重呼び出しで document リスナーが二重登録されない", () => {
      installPointerLockDoc();
      const el = makeElement();
      const addSpy = vi.spyOn(document, "addEventListener");
      const core = new PointerLockCore();

      core.observe(el);
      core.observe(el);

      const calls = addSpy.mock.calls.filter(([type]) => type === "pointerlockchange");
      expect(calls).toHaveLength(1);
    });

    it("dispose 後の再 observe で復活する", () => {
      const doc = installPointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();

      core.observe(el);
      core.dispose();
      core.observe(el);

      doc.setLockedElement(el);
      expect(core.active).toBe(true);
    });

    it("一度も observe していない dispose は安全な no-op", () => {
      const core = new PointerLockCore();
      expect(() => core.dispose()).not.toThrow();
    });

    it("dispose() は進行中の change 購読を解除する", () => {
      const doc = installPointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);

      core.dispose();
      doc.setLockedElement(el);

      expect(core.active).toBe(false);
    });
  });

  describe("movementX/movementY のスコープ外確認（回帰）", () => {
    it("wcBindable.properties に movementX/movementY が含まれない", () => {
      const names = PointerLockCore.wcBindable.properties.map((p) => p.name);
      expect(names).not.toContain("movementX");
      expect(names).not.toContain("movementY");
      expect(names).toEqual(["active"]);
    });
  });

  describe("wcBindable プロトコル宣言", () => {
    it("exitPointerLock は async フラグを持たない（同期 API）", () => {
      const cmd = PointerLockCore.wcBindable.commands!.find((c) => c.name === "exitPointerLock")!;
      expect(cmd.async).toBeUndefined();
    });

    it("requestPointerLock は async: true を持つ", () => {
      const cmd = PointerLockCore.wcBindable.commands!.find((c) => c.name === "requestPointerLock")!;
      expect(cmd.async).toBe(true);
    });

    it("active は getter を持たない（detail 自体が boolean 値）", () => {
      const prop = PointerLockCore.wcBindable.properties.find((p) => p.name === "active")!;
      expect(prop.getter).toBeUndefined();
    });
  });
});
