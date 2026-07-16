import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BroadcastCore } from "../src/core/BroadcastCore";
import {
  FakeBroadcastChannel,
  installBroadcastChannel,
  removeBroadcastChannel,
  restoreBroadcastChannel,
} from "./mocks";

describe("BroadcastCore", () => {
  beforeEach(() => {
    installBroadcastChannel();
  });

  afterEach(() => {
    restoreBroadcastChannel();
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("message と error は null で始まる", () => {
      const core = new BroadcastCore();
      expect(core.message).toBeNull();
      expect(core.error).toBeNull();
    });

    it("コンストラクタ時点ではチャンネルを開かない", () => {
      new BroadcastCore();
      expect(FakeBroadcastChannel.created).toHaveLength(0);
    });
  });

  describe("open", () => {
    it("名前付きチャンネルを開く", () => {
      const core = new BroadcastCore();
      core.open("room");
      expect(FakeBroadcastChannel.created).toHaveLength(1);
      expect(FakeBroadcastChannel.created[0].name).toBe("room");
    });

    it("再度 open すると旧チャンネルを閉じて切り替える", () => {
      const core = new BroadcastCore();
      core.open("a");
      core.open("b");
      expect(FakeBroadcastChannel.created).toHaveLength(2);
      expect(FakeBroadcastChannel.registry.get("a")!.size).toBe(0);
      expect(FakeBroadcastChannel.registry.get("b")!.size).toBe(1);
    });

    it("同名で再度 open しても作り直さない（昇格時の二重 open を吸収する）", () => {
      // upgrade 経路では attributeChangedCallback(isConnected=true)→connectedCallback
      // の順で Shell が open() を2回呼ぶ。同名なら2回目を no-op にして churn を防ぐ。
      const core = new BroadcastCore();
      core.open("room");
      core.open("room");
      expect(FakeBroadcastChannel.created).toHaveLength(1);
      expect(FakeBroadcastChannel.registry.get("room")!.size).toBe(1);
    });

    it("close 後は同名でも open し直すと新チャンネルを作る", () => {
      const core = new BroadcastCore();
      core.open("room");
      core.close();
      core.open("room");
      expect(FakeBroadcastChannel.created).toHaveLength(2);
      expect(FakeBroadcastChannel.registry.get("room")!.size).toBe(1);
    });

    it("a→b→a と切り替えると毎回作り直す（直前と同名でない限り同名ガードは効かない）", () => {
      // 同名ガード（this._name === name）は「直前に開いたチャンネルと同名」のときだけ
      // no-op にする。a→b→a では b の次に a を開くので _name==="b"≠"a"、a を新規に作り直す。
      const core = new BroadcastCore();
      core.open("a");
      core.open("b");
      core.open("a");
      expect(FakeBroadcastChannel.created).toHaveLength(3);
      expect(FakeBroadcastChannel.registry.get("a")!.size).toBe(1); // 最後に開いた a が生きている
      expect(FakeBroadcastChannel.registry.get("b")!.size).toBe(0); // b は閉じられている
    });

    it("BroadcastChannel 非対応環境では unsupported エラーを出し、チャンネルを開かない", () => {
      removeBroadcastChannel();
      const core = new BroadcastCore();
      core.open("room");
      expect(core.error).toEqual({
        name: "NotSupportedError",
        message: "BroadcastChannel is not available in this environment.",
      });
    });
  });

  describe("post（自己除外つき配信）", () => {
    it("同一チャンネルの他インスタンスにのみ届く（送信元は受け取らない）", () => {
      const targetA = new EventTarget();
      const targetB = new EventTarget();
      const coreA = new BroadcastCore(targetA);
      const coreB = new BroadcastCore(targetB);
      coreA.open("room");
      coreB.open("room");

      coreA.post("hello");

      expect(coreB.message).toBe("hello");
      expect(coreA.message).toBeNull(); // self-exclusion
    });

    it("message イベントを target に dispatch する", () => {
      const targetA = new EventTarget();
      const targetB = new EventTarget();
      const coreA = new BroadcastCore(targetA);
      const coreB = new BroadcastCore(targetB);
      coreA.open("room");
      coreB.open("room");

      const received: any[] = [];
      targetB.addEventListener("wcs-broadcast:message", (e) => {
        received.push((e as CustomEvent).detail);
      });

      coreA.post("ping");
      expect(received).toEqual(["ping"]);
    });

    it("オブジェクトは structured clone でコピーされて届く（参照は共有しない）", () => {
      const coreA = new BroadcastCore(new EventTarget());
      const coreB = new BroadcastCore(new EventTarget());
      coreA.open("room");
      coreB.open("room");

      const payload = { n: 1, nested: { items: [1, 2] } };
      coreA.post(payload);

      expect(coreB.message).toEqual(payload);
      expect(coreB.message).not.toBe(payload);
      expect(coreB.message.nested).not.toBe(payload.nested);
    });

    it("同じ値を2回 post すると2回 message が発火する（イベント＝冪等でない）", () => {
      const coreA = new BroadcastCore(new EventTarget());
      const targetB = new EventTarget();
      const coreB = new BroadcastCore(targetB);
      coreA.open("room");
      coreB.open("room");

      const received: any[] = [];
      targetB.addEventListener("wcs-broadcast:message", (e) => {
        received.push((e as CustomEvent).detail);
      });

      coreA.post("x");
      coreA.post("x");
      expect(received).toEqual(["x", "x"]);
    });

    it("null も他コンテキストに届く（値の有無ではなく structured clone 可否で判断）", () => {
      const coreA = new BroadcastCore(new EventTarget());
      const coreB = new BroadcastCore(new EventTarget());
      coreA.open("room");
      coreB.open("room");

      coreA.post(null);
      expect(coreB.message).toBeNull();
      expect(coreA.error).toBeNull(); // null は正当なペイロード（エラーにならない）
    });

    it("undefined も他コンテキストに届く", () => {
      const coreA = new BroadcastCore(new EventTarget());
      const coreB = new BroadcastCore(new EventTarget());
      coreA.open("room");
      coreB.open("room");

      coreA.post("seed"); // 既存値を入れてから上書きを確認
      expect(coreB.message).toBe("seed");
      coreA.post(undefined);
      expect(coreB.message).toBeUndefined();
      expect(coreA.error).toBeNull();
    });

    it("チャンネル未 open で post すると InvalidStateError", () => {
      const core = new BroadcastCore();
      core.post("hello");
      expect(core.error).toEqual({
        name: "InvalidStateError",
        message: "Channel is not open. Call open(name) before post().",
      });
    });

    it("クローン不可な値を post すると DataCloneError", () => {
      const core = new BroadcastCore();
      core.open("room");
      core.post(() => {});
      expect(core.error?.name).toBe("DataCloneError");
    });

    it("Error 以外が throw された場合も正規化する", () => {
      vi.spyOn(FakeBroadcastChannel.prototype, "postMessage").mockImplementation(() => {
        throw "boom";
      });
      const core = new BroadcastCore();
      core.open("room");
      core.post("x");
      expect(core.error).toEqual({ name: "Error", message: "boom" });
    });

    it("非対応環境で post すると unsupported エラー", () => {
      removeBroadcastChannel();
      const core = new BroadcastCore();
      core.post("x");
      expect(core.error?.name).toBe("NotSupportedError");
    });
  });

  describe("messageerror", () => {
    it("復元失敗時に DataError を出す", () => {
      const core = new BroadcastCore();
      core.open("room");
      FakeBroadcastChannel.dispatchMessageError("room");
      expect(core.error).toEqual({
        name: "DataError",
        message: "Failed to deserialize a message received on the channel.",
      });
    });
  });

  describe("close", () => {
    it("チャンネルを閉じ、レジストリから外す", () => {
      const core = new BroadcastCore();
      core.open("room");
      core.close();
      expect(FakeBroadcastChannel.registry.get("room")!.size).toBe(0);
    });

    it("未 open でも no-op", () => {
      const core = new BroadcastCore();
      expect(() => core.close()).not.toThrow();
    });

    it("close 後は他インスタンスの post を受け取らない", () => {
      const coreA = new BroadcastCore(new EventTarget());
      const coreB = new BroadcastCore(new EventTarget());
      coreA.open("room");
      coreB.open("room");
      coreB.close();

      coreA.post("hello");
      expect(coreB.message).toBeNull();
    });
  });

  describe("error の同値ガード", () => {
    it("open の error クリア（null→null）では重複 dispatch しない", () => {
      const target = new EventTarget();
      const core = new BroadcastCore(target);
      let count = 0;
      target.addEventListener("wcs-broadcast:error", () => { count++; });
      core.open("a"); // error は元々 null → 同値ガードで dispatch なし
      expect(count).toBe(0);
    });

    it("エラー発生後に open すると一度だけ error クリアが dispatch される", () => {
      const target = new EventTarget();
      const core = new BroadcastCore(target);
      core.post("x"); // InvalidStateError
      const events: any[] = [];
      target.addEventListener("wcs-broadcast:error", (e) => {
        events.push((e as CustomEvent).detail);
      });
      core.open("a"); // error: {...} → null
      expect(events).toEqual([null]);
      expect(core.error).toBeNull();
    });
  });

  describe("ready / observe（SSR・ライフサイクル）", () => {
    it("ready は解決済み Promise を返す", async () => {
      const core = new BroadcastCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() は ready を返し、冪等に再呼び出しできる", async () => {
      const core = new BroadcastCore();
      await expect(core.observe()).resolves.toBeUndefined();
      await expect(core.observe()).resolves.toBeUndefined();
    });

    it("observe() は ready と同一の Promise を返す", () => {
      const core = new BroadcastCore();
      expect(core.observe()).toBe(core.ready);
    });
  });

  describe("dispose", () => {
    it("チャンネルを閉じ、error を silent にリセットする", () => {
      const target = new EventTarget();
      const core = new BroadcastCore(target);
      core.post("x"); // error をセット
      expect(core.error).not.toBeNull();

      const events: any[] = [];
      target.addEventListener("wcs-broadcast:error", (e) => events.push(e));
      expect(core.errorInfo).not.toBeNull(); // post が errorInfo をセット済み
      core.dispose();

      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull(); // errorInfo も error に追随して silent クリア
      expect(events).toHaveLength(0); // dispose では dispatch しない
    });

    it("dispose 後はチャンネルがレジストリから外れている", () => {
      const core = new BroadcastCore();
      core.open("room");
      core.dispose();
      expect(FakeBroadcastChannel.registry.get("room")!.size).toBe(0);
    });

    it("dispose 後に post すると InvalidStateError（チャンネルが閉じられているため）", () => {
      const core = new BroadcastCore();
      core.open("room");
      core.dispose();
      core.post("x");
      expect(core.error).toEqual({
        name: "InvalidStateError",
        message: "Channel is not open. Call open(name) before post().",
      });
    });

    // _gen 世代ガード（§3.4）: dispose() で _gen を進めると、teardown 後に遅れて
    // drain した message / messageerror を stale として破棄する。dispose は listener
    // を removeEventListener で外すため、プラットフォームで「close 直前にキューされた
    // イベントが close 後に配送される」状況を再現するには、open() 時に登録された
    // handler 参照を addEventListener のスパイで捕捉し、dispose 後に直接呼び出す。
    function captureHandlers(target?: EventTarget): {
      core: BroadcastCore;
      onMessage: EventListener;
      onMessageError: EventListener;
    } {
      const handlers: Record<string, EventListener> = {};
      const spy = vi
        .spyOn(FakeBroadcastChannel.prototype, "addEventListener")
        .mockImplementation(function (this: FakeBroadcastChannel, type: string, listener: any) {
          handlers[type] = listener as EventListener;
          // 実際の登録も行う（既存挙動を保つ）
          return EventTarget.prototype.addEventListener.call(this, type, listener);
        });
      const core = new BroadcastCore(target);
      core.open("room");
      spy.mockRestore();
      // dispose で _gen を進める（listener も外れる）
      core.dispose();
      return { core, onMessage: handlers.message, onMessageError: handlers.messageerror };
    }

    it("dispose 後に drain した stale message は message を更新しない（_gen ガード）", () => {
      const { core, onMessage } = captureHandlers();
      const event = new Event("message") as Event & { data: unknown };
      event.data = "late";
      onMessage(event);
      expect(core.message).toBeNull(); // stale なので _setMessage されない
    });

    it("dispose 後に drain した stale messageerror は error を書かない（_gen ガード）", () => {
      const target = new EventTarget();
      const events: any[] = [];
      target.addEventListener("wcs-broadcast:error", (e) => events.push(e));
      const { core, onMessageError } = captureHandlers(target);
      onMessageError(new Event("messageerror"));
      expect(core.error).toBeNull(); // dispose で null にリセット済み、再書き込みなし
      expect(events).toHaveLength(0);
    });
  });

  describe("errorInfo taxonomy (Phase 6)", () => {
    it("初期状態の errorInfo は null", () => {
      expect(new BroadcastCore().errorInfo).toBeNull();
    });

    it("errorInfo は wcBindable property(error の直後)として宣言される", () => {
      const names = BroadcastCore.wcBindable.properties.map((p) => p.name);
      expect(names).toContain("errorInfo");
      expect(names.indexOf("errorInfo")).toBe(names.indexOf("error") + 1);
    });

    it("非対応(NotSupportedError)→ capability-missing / probe / recoverable=false", () => {
      removeBroadcastChannel();
      const core = new BroadcastCore();
      core.open("room");
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "probe", recoverable: false,
        message: "BroadcastChannel is not available in this environment.",
      });
      // 公開 error shape は不変。
      expect(core.error).toEqual({
        name: "NotSupportedError",
        message: "BroadcastChannel is not available in this environment.",
      });
    });

    it("クローン不可な payload の post(DataCloneError)→ invalid-argument / execute / recoverable=false", () => {
      const core = new BroadcastCore();
      core.open("room");
      core.post(() => {});
      expect(core.error?.name).toBe("DataCloneError"); // 公開 error shape は不変
      expect(core.errorInfo).toMatchObject({
        code: "invalid-argument", phase: "execute", recoverable: false,
      });
      expect(typeof core.errorInfo?.message).toBe("string");
    });

    it("チャンネル未 open の post(InvalidStateError)→ broadcast-error / execute", () => {
      const core = new BroadcastCore();
      core.post("x");
      expect(core.errorInfo).toEqual({
        code: "broadcast-error", phase: "execute", recoverable: false,
        message: "Channel is not open. Call open(name) before post().",
      });
    });

    it("deserialize 失敗(DataError)→ broadcast-error / execute", () => {
      const core = new BroadcastCore();
      core.open("room");
      FakeBroadcastChannel.dispatchMessageError("room");
      expect(core.errorInfo).toEqual({
        code: "broadcast-error", phase: "execute", recoverable: false,
        message: "Failed to deserialize a message received on the channel.",
      });
    });

    it("error が null にクリアされると errorInfo も null になる(open による回復経路)", () => {
      const core = new BroadcastCore();
      core.post("x"); // InvalidStateError → errorInfo セット
      expect(core.errorInfo).not.toBeNull();
      core.open("room"); // error: {...} → null
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("errorInfo は error と同期して遷移し、error より前に error-info-changed が流れる", () => {
      const target = new EventTarget();
      const core = new BroadcastCore(target);
      const order: string[] = [];
      target.addEventListener("wcs-broadcast:error-info-changed", () => order.push("errorInfo"));
      target.addEventListener("wcs-broadcast:error", () => order.push("error"));
      core.post("x"); // InvalidStateError
      expect(order).toEqual(["errorInfo", "error"]);
      expect(core.errorInfo).not.toBeNull();
    });
  });

  describe("target 省略時", () => {
    it("自身を EventTarget としてイベントを dispatch する", () => {
      const core = new BroadcastCore();
      const received: any[] = [];
      core.addEventListener("wcs-broadcast:error", (e) => {
        received.push((e as CustomEvent).detail);
      });
      core.post("x"); // InvalidStateError
      expect(received).toHaveLength(1);
      expect(received[0].name).toBe("InvalidStateError");
    });
  });
});
