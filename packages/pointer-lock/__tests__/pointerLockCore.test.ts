import { describe, it, expect, afterEach, vi } from "vitest";
import { PointerLockCore } from "../src/core/PointerLockCore";
import { installPointerLockDoc, removePointerLockDoc, withoutDocumentHandlers } from "./mocks";

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

  describe("requestPointerLock() — target 未解決（null）", () => {
    it("「API 未対応」とは別のメッセージで error へ落ちる", async () => {
      installPointerLockDoc();
      const core = new PointerLockCore();

      await core.requestPointerLock(null);

      expect(core.error).toEqual({ message: "Pointer Lock target could not be resolved." });
      expect(core.active).toBe(false);
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

    it("先発 requestPointerLock() が後発の reject 後に resolve しても、後発が設定した error を上書きしない", async () => {
      // 成功パス側の stale ガード（`await fn()` 直後の `if (gen !== this._gen) return;`）
      // 専用の検証。dispose 経路の2テストは
      // どちらも dispose() が _resolvedTarget を null にするため、このガードを
      // 削除しても _applyActive() が自然に false を返し検出できない（弱い
      // assert）。ここでは dispose を挟まず、同一 Core 上で先発(A)が pending の
      // まま後発(B)が reject → error 設定 → その後に A が resolve、という順序で
      // 「A の遅い成功が B の error を誤って握り潰さないこと」を直接検証する。
      const elA = makeElement();
      const elB = makeElement();
      let resolveA!: () => void;
      installPointerLockDoc({}, function (this: Element) {
        if (this === elA) {
          return new Promise<void>((resolve) => {
            resolveA = resolve;
          });
        }
        return Promise.reject(new DOMException("gesture required", "NotAllowedError"));
      });
      const core = new PointerLockCore();

      const pA = core.requestPointerLock(elA); // gen=1, pending のまま
      await core.requestPointerLock(elB); // gen=2, 同期的に reject → error 設定

      expect(core.error).toBeInstanceOf(DOMException);

      resolveA();
      await pA; // gen=1 の成功が stale として無視されるべき

      expect(core.error).toBeInstanceOf(DOMException);
      expect((core.error as DOMException).name).toBe("NotAllowedError");
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
      expect(names).toEqual(["active", "error", "errorInfo", "supported"]);
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

    it("error / errorInfo が observable な失敗出力(event 付き)として宣言される", () => {
      expect(PointerLockCore.wcBindable.properties).toHaveLength(4);
      expect(PointerLockCore.wcBindable.properties[1]).toEqual({ name: "error", event: "wcs-pointer-lock:error", semantics: "state" });
      expect(PointerLockCore.wcBindable.properties[2]).toEqual({ name: "errorInfo", event: "wcs-pointer-lock:error-info-changed", semantics: "state" });
    });

    it("supported が state 出力として宣言される（getter なし: detail が boolean そのもの）", () => {
      expect(PointerLockCore.wcBindable.properties[3]).toEqual({ name: "supported", event: "wcs-pointer-lock:supported-changed", semantics: "state" });
    });
  });

  describe("dispose() — active を false で公開する（timing contract §22）", () => {
    it("ロック中の dispose は change を false で発火し、active は false になる（ロックは解かない）", async () => {
      const doc = installPointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      await core.requestPointerLock(el);
      const events: any[] = [];
      core.addEventListener("wcs-pointer-lock:change", (e) => events.push((e as CustomEvent).detail));

      core.dispose();

      expect(events).toEqual([false]);
      expect(core.active).toBe(false);
      // 解くのはブラウザ（か利用者）で、dispose ではない: exitPointerLock は呼ばれて
      // おらず、document.pointerLockElement はそのまま。
      expect(doc.getLockedElement()).toBe(el);
    });

    it("dispose のあと target がまだロック中なら、observe() が true を公開し直す", async () => {
      installPointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      await core.requestPointerLock(el);
      const events: any[] = [];
      core.addEventListener("wcs-pointer-lock:change", (e) => events.push((e as CustomEvent).detail));

      core.dispose();
      core.observe(el); // Shell の再接続に相当

      expect(events).toEqual([false, true]);
      expect(core.active).toBe(true);
    });

    it("dispose のあいだにロックが解けていれば、再接続しても false のまま（イベントも出ない）", async () => {
      const doc = installPointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      await core.requestPointerLock(el);
      core.dispose();
      const events: any[] = [];
      core.addEventListener("wcs-pointer-lock:change", (e) => events.push((e as CustomEvent).detail));

      doc.setLockedElement(null); // 購読していないので届かない
      core.observe(el);

      expect(events).toEqual([]);
      expect(core.active).toBe(false);
    });

    it("ロックしていない dispose は change を発火しない（二重の dispose も同じ）", async () => {
      installPointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      const events: any[] = [];
      core.addEventListener("wcs-pointer-lock:change", (e) => events.push((e as CustomEvent).detail));

      core.dispose();
      expect(events).toEqual([]);

      core.observe(el);
      await core.requestPointerLock(el);
      core.dispose();
      core.dispose();
      expect(events).toEqual([true, false]);
    });
  });

  describe("pointerlockerror — イベントで届く拒否（Firefox）", () => {
    // Firefox の requestPointerLock() は何も返さない（reject する promise が無い）。
    // 答えは document の pointerlockchange / pointerlockerror で届く。
    const silentRequest = function (this: Element): Promise<void> {
      return undefined as unknown as Promise<void>;
    };

    function collectErrors(core: PointerLockCore): any[] {
      const errors: any[] = [];
      core.addEventListener("wcs-pointer-lock:error", (e) => errors.push((e as CustomEvent).detail));
      return errors;
    }

    it("promise を返さない要求が保留中にイベントが来ると error が立つ（not-allowed / recoverable）", async () => {
      const doc = installPointerLockDoc({}, silentRequest);
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      const errors = collectErrors(core);

      await core.requestPointerLock(el);
      expect(core.error).toBeNull();

      doc.fireError();

      expect(core.error).toBeInstanceOf(DOMException);
      expect(core.error.name).toBe("NotAllowedError");
      expect(core.errorInfo).toEqual({
        code: "not-allowed", phase: "execute", recoverable: true,
        message: "The browser refused the pointer lock request.",
      });
      expect(core.active).toBe(false);
      expect(errors).toHaveLength(1);

      // 答えの出た要求は保留ではない: 続けて来たイベントは重ねて報告しない。
      doc.fireError();
      expect(errors).toHaveLength(1);
    });

    it("reject された promise の後にイベントが来ても、報告は 1 回だけ（promise の例外が残る）", async () => {
      // Chromium と WebKit: promise が reject し、同じ拒否のイベントも後から来る。
      const rejection = new DOMException("gesture required", "NotAllowedError");
      const doc = installPointerLockDoc({}, function () {
        return Promise.reject(rejection);
      });
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      const errors = collectErrors(core);

      await core.requestPointerLock(el);
      doc.fireError();

      expect(errors).toEqual([rejection]);
      expect(core.error).toBe(rejection);
    });

    it("promise を返した要求は promise だけが答える: 決着前に来たイベントでは error を立てず、reject の例外を 1 回だけ報告する", async () => {
      // WebKit はブラウザが後から断るとき（ウィンドウにフォーカスが無い、など）、
      // pointerlockerror を先に発火してから promise を reject する（実測）。理由
      // （WrongDocumentError: Pointer lock requires the window to have focus.）を
      // 持っているのは reject の例外のほう。
      let rejectFn!: (e: unknown) => void;
      const doc = installPointerLockDoc({}, function () {
        return new Promise<void>((_resolve, reject) => {
          rejectFn = reject;
        });
      });
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      const errors = collectErrors(core);

      const p = core.requestPointerLock(el);
      doc.fireError();
      expect(errors).toEqual([]);
      expect(core.error).toBeNull();

      const rejection = new DOMException("Pointer lock requires the window to have focus.", "WrongDocumentError");
      rejectFn(rejection);
      await p;

      expect(errors).toEqual([rejection]);
      expect(core.error).toBe(rejection);
      expect(core.errorInfo?.code).toBe("pointer-lock-error");
    });

    it("promise を返した要求の決着前に来たイベント（他のインスタンスの拒否）は無視し、fulfil で active になる", async () => {
      let resolveFn!: () => void;
      const doc = installPointerLockDoc({}, function () {
        return new Promise<void>((resolve) => {
          resolveFn = resolve;
        });
      });
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      const errors = collectErrors(core);

      const p = core.requestPointerLock(el);
      doc.fireError();

      doc.setLockedElement(el);
      resolveFn();
      await p;

      expect(errors).toEqual([]);
      expect(core.error).toBeNull();
      expect(core.active).toBe(true);
    });

    it("promise を返す呼び出しの中で同期的にイベントが発火しても、答えるのは promise", async () => {
      const rejection = new DOMException("gesture required", "NotAllowedError");
      const doc = installPointerLockDoc({}, function () {
        doc.fireError();
        return Promise.reject(rejection);
      });
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      const errors = collectErrors(core);

      await core.requestPointerLock(el);

      expect(errors).toEqual([rejection]);
    });

    it("promise を返さない要求は、呼んだ時点で前の error を消す（答えはその後のイベント）", async () => {
      const doc = installPointerLockDoc({}, silentRequest);
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      await core.requestPointerLock(null);
      expect(core.error).not.toBeNull();

      const p = core.requestPointerLock(el);
      expect(core.error).toBeNull(); // await を待たずに消えている
      doc.fireError(); // コマンドの promise が決着する前でも答えになる
      await p;

      expect(core.error.name).toBe("NotAllowedError");
    });

    it("要求が保留中でなければイベントを無視する（他のインスタンスの要求）", async () => {
      const doc = installPointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      const errors = collectErrors(core);

      doc.fireError(); // 一度も要求していない
      expect(core.error).toBeNull();

      await core.requestPointerLock(el); // promise が fulfil して決着
      doc.fireError();

      expect(core.error).toBeNull();
      expect(errors).toEqual([]);
    });

    it("promise を返さない要求が pointerlockchange で成功したら、その後のイベントは無視する", async () => {
      const doc = installPointerLockDoc({}, silentRequest);
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);

      await core.requestPointerLock(el);
      doc.setLockedElement(el);
      expect(core.active).toBe(true);

      doc.fireError();

      expect(core.error).toBeNull();
    });

    it("pointerlockchange が来ても自分の target がロックされていなければ、要求は保留のまま", async () => {
      const doc = installPointerLockDoc({}, silentRequest);
      const el = makeElement();
      const other = makeElement();
      const core = new PointerLockCore();
      core.observe(el);

      await core.requestPointerLock(el);
      doc.setLockedElement(other);
      expect(core.active).toBe(false);

      doc.fireError();

      expect(core.error.name).toBe("NotAllowedError");
    });

    it("呼び出しの中で同期的にイベントが発火しても、error は消えない", async () => {
      const doc = installPointerLockDoc({}, function () {
        doc.fireError();
        return undefined as unknown as Promise<void>;
      });
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);
      const errors = collectErrors(core);

      await core.requestPointerLock(el);

      expect(core.error.name).toBe("NotAllowedError");
      expect(errors).toHaveLength(1);
    });

    it("後から呼んだ requestPointerLock() は前の保留を引き継がない", async () => {
      const doc = installPointerLockDoc({}, silentRequest);
      const el = makeElement();
      const core = new PointerLockCore();
      core.observe(el);

      await core.requestPointerLock(el); // 保留
      await core.requestPointerLock(null); // target 未解決: 同期の失敗で、保留は無い
      const unresolved = core.error;
      expect(unresolved).toEqual({ message: "Pointer Lock target could not be resolved." });

      doc.fireError();

      expect(core.error).toBe(unresolved);
    });

    it("observe() で 1 回だけ購読し、dispose() で外す（外した後のイベントは届かない）", async () => {
      const doc = installPointerLockDoc({}, silentRequest);
      const el = makeElement();
      const addSpy = vi.spyOn(document, "addEventListener");
      const removeSpy = vi.spyOn(document, "removeEventListener");
      const core = new PointerLockCore();

      core.observe(el);
      core.observe(el);
      expect(addSpy.mock.calls.filter(([type]) => type === "pointerlockerror")).toHaveLength(1);

      await core.requestPointerLock(el); // 保留
      core.dispose();
      expect(removeSpy.mock.calls.filter(([type]) => type === "pointerlockerror")).toHaveLength(1);

      doc.fireError();
      expect(core.error).toBeNull();

      // 再購読しても、dispose で捨てた保留は戻らない。
      core.observe(el);
      doc.fireError();
      expect(core.error).toBeNull();
    });

    it("標準の onpointerlockerror が無ければ webkitpointerlockerror を購読する", async () => {
      await withoutDocumentHandlers(["onpointerlockchange", "onpointerlockerror"], async () => {
        expect("onpointerlockerror" in document).toBe(false);

        const doc = installPointerLockDoc({ standard: false, legacy: true }, silentRequest);
        const el = makeElement();
        const addSpy = vi.spyOn(document, "addEventListener");
        const removeSpy = vi.spyOn(document, "removeEventListener");
        const core = new PointerLockCore();

        core.observe(el);
        expect(addSpy).toHaveBeenCalledWith("webkitpointerlockerror", expect.any(Function));

        await core.requestPointerLock(el);
        document.dispatchEvent(new Event("pointerlockerror")); // 標準名は聞いていない
        expect(core.error).toBeNull();
        doc.fireError();
        expect(core.error.name).toBe("NotAllowedError");

        core.dispose();
        expect(removeSpy).toHaveBeenCalledWith("webkitpointerlockerror", expect.any(Function));
      });
      expect("onpointerlockerror" in document).toBe(true);
    });
  });

  describe("supported — このページに Pointer Lock API があるか", () => {
    it("API が無い環境では false", () => {
      removePointerLockDoc();
      expect(new PointerLockCore().supported).toBe(false);
    });

    it("Element.prototype に requestPointerLock があれば true", () => {
      installPointerLockDoc();
      expect(new PointerLockCore().supported).toBe(true);
    });

    it("レガシー名（webkitRequestPointerLock）だけでも true", () => {
      installPointerLockDoc({ standard: false, legacy: true });
      expect(new PointerLockCore().supported).toBe(true);
    });

    it("値はキャッシュしない: 呼ぶたびに調べ直す", () => {
      const core = new PointerLockCore();
      expect(core.supported).toBe(false);
      installPointerLockDoc();
      expect(core.supported).toBe(true);
      removePointerLockDoc();
      expect(core.supported).toBe(false);
    });

    it("observe() は、最後に発火した値（初期値 false）と違うときだけ supported-changed を発火する", () => {
      const el = makeElement();
      const core = new PointerLockCore();
      const events: Array<{ detail: unknown; bubbles: boolean }> = [];
      core.addEventListener("wcs-pointer-lock:supported-changed", (e) => {
        events.push({ detail: (e as CustomEvent).detail, bubbles: e.bubbles });
      });

      core.observe(el); // API が無い: 初期値 false と同じなので発火しない
      expect(events).toEqual([]);

      installPointerLockDoc();
      core.observe(el);
      expect(events).toEqual([{ detail: true, bubbles: true }]);
      core.observe(el); // 同値: 発火しない
      core.dispose();
      core.observe(el); // 再接続しても同値
      expect(events).toHaveLength(1);

      removePointerLockDoc();
      core.observe(el); // API が無くなった
      expect(events).toEqual([{ detail: true, bubbles: true }, { detail: false, bubbles: true }]);
    });

    it("target に指定した EventTarget へ supported-changed を dispatch する", () => {
      installPointerLockDoc();
      const target = new EventTarget();
      const events: unknown[] = [];
      target.addEventListener("wcs-pointer-lock:supported-changed", (e) => events.push((e as CustomEvent).detail));

      new PointerLockCore(target).observe(makeElement());

      expect(events).toEqual([true]);
    });
  });

  describe("errorInfo taxonomy (Phase 6)", () => {
    it("初期状態の errorInfo は null", () => {
      expect(new PointerLockCore().errorInfo).toBeNull();
    });

    it("target 未解決 → invalid-argument / start / recoverable=false", async () => {
      installPointerLockDoc();
      const core = new PointerLockCore();
      await core.requestPointerLock(null);
      expect(core.errorInfo).toEqual({
        code: "invalid-argument", phase: "start", recoverable: false,
        message: "Pointer Lock target could not be resolved.",
      });
    });

    it("unsupported → capability-missing / probe / recoverable=false", async () => {
      removePointerLockDoc();
      const el = makeElement();
      const core = new PointerLockCore();
      await core.requestPointerLock(el);
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "probe", recoverable: false,
        message: "Pointer Lock API is not supported.",
      });
    });

    it("TypeError(gesture 外)→ not-allowed / execute / recoverable=true", async () => {
      installPointerLockDoc({}, function () {
        return Promise.reject(new TypeError("needs a user gesture"));
      });
      const el = makeElement();
      const core = new PointerLockCore();
      await core.requestPointerLock(el);
      expect(core.errorInfo).toEqual({ code: "not-allowed", phase: "execute", recoverable: true, message: "needs a user gesture" });
    });

    it("NotAllowedError → not-allowed / execute / recoverable=true", async () => {
      installPointerLockDoc({}, function () {
        return Promise.reject(new DOMException("denied", "NotAllowedError"));
      });
      const el = makeElement();
      const core = new PointerLockCore();
      await core.requestPointerLock(el);
      expect(core.errorInfo).toEqual({ code: "not-allowed", phase: "execute", recoverable: true, message: "denied" });
    });

    it("その他 caught 例外 → pointer-lock-error / execute / recoverable=false", async () => {
      const err = new Error("boom"); err.name = "InvalidStateError";
      installPointerLockDoc({}, function () {
        return Promise.reject(err);
      });
      const el = makeElement();
      const core = new PointerLockCore();
      await core.requestPointerLock(el);
      expect(core.errorInfo).toEqual({ code: "pointer-lock-error", phase: "execute", recoverable: false, message: "boom" });
    });

    it("非 Error(message 非 string)の reject も never-throw で pointer-lock-error に分類", async () => {
      // string を throw: .message を持たないので messageOf は String(error) にフォールバック。
      installPointerLockDoc({}, function () {
        return Promise.reject("raw failure");
      });
      const el = makeElement();
      const core = new PointerLockCore();
      await expect(core.requestPointerLock(el)).resolves.toBeUndefined();
      expect(core.errorInfo).toEqual({ code: "pointer-lock-error", phase: "execute", recoverable: false, message: "raw failure" });
    });

    it("成功で errorInfo が null にクリアされ、error と同期する", async () => {
      installPointerLockDoc();
      const core = new PointerLockCore();
      await core.requestPointerLock(null); // まず error を立てる
      expect(core.errorInfo).not.toBeNull();
      const el = makeElement();
      await core.requestPointerLock(el);
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("wcs-pointer-lock:error-info-changed が error より前に発火する", async () => {
      installPointerLockDoc();
      const core = new PointerLockCore();
      const order: string[] = [];
      core.addEventListener("wcs-pointer-lock:error-info-changed", () => order.push("errorInfo"));
      core.addEventListener("wcs-pointer-lock:error", () => order.push("error"));
      await core.requestPointerLock(null);
      expect(order).toEqual(["errorInfo", "error"]);
    });
  });
});
