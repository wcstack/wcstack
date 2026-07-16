import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WakeLockCore } from "../src/core/WakeLockCore.js";
import {
  installWakeLock,
  uninstallWakeLock,
  installVisibility,
  setVisibility,
  WakeLockControl,
} from "./mocks.js";

// Flush microtasks + a macrotask turn so an async _acquire() chain (which awaits
// navigator.wakeLock.request) settles before assertions.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("WakeLockCore", () => {
  let teardownVisibility: () => void;
  let wl: WakeLockControl;

  // Track every core so afterEach can dispose it — a core that called request()
  // leaves a document `visibilitychange` listener that would otherwise persist and
  // fire (against the next test's mock) when a later test calls setVisibility().
  const cores: WakeLockCore[] = [];
  const makeCore = (target?: EventTarget, type?: "screen"): WakeLockCore => {
    const c = new WakeLockCore(target, type);
    cores.push(c);
    return c;
  };

  beforeEach(() => {
    teardownVisibility = installVisibility("visible");
    wl = installWakeLock();
  });

  afterEach(() => {
    cores.forEach((c) => c.dispose());
    cores.length = 0;
    wl.restore();
    teardownVisibility();
  });

  it("request() で sentinel を取得し held=true になる（type は screen）", async () => {
    const core = makeCore();
    await core.request();
    expect(core.held).toBe(true);
    expect(core.active).toBe(true);
    expect(wl.request).toHaveBeenCalledTimes(1);
    expect(wl.request).toHaveBeenCalledWith("screen");
  });

  it("held-changed / error イベントを target に dispatch する", async () => {
    const target = new EventTarget();
    const core = makeCore(target);
    const onHeld = vi.fn();
    target.addEventListener("wcs-wakelock:held-changed", onHeld);
    await core.request();
    expect(onHeld).toHaveBeenCalledTimes(1);
    expect((onHeld.mock.calls[0][0] as CustomEvent).detail).toBe(true);
  });

  it("request() は冪等（保持中の再 request は新たに取得しない）", async () => {
    const core = makeCore();
    await core.request();
    await core.request();
    expect(wl.request).toHaveBeenCalledTimes(1);
    expect(core.held).toBe(true);
  });

  it("release() で sentinel を解放し held=false・active=false になる", async () => {
    const core = makeCore();
    await core.request();
    const sentinel = wl.last()!;
    core.release();
    expect(core.held).toBe(false);
    expect(core.active).toBe(false);
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("未対応環境（navigator.wakeLock なし）では no-op・never-throw", async () => {
    uninstallWakeLock();
    const core = makeCore();
    await expect(core.request()).resolves.toBeUndefined();
    expect(core.held).toBe(false);
    expect(core.active).toBe(true); // 望みは保持される
  });

  it("② 非表示中の request は取得を保留し、表示復帰で再取得する", async () => {
    setVisibility("hidden");
    const core = makeCore();
    await core.request();
    expect(core.held).toBe(false); // 非表示なので取得しない
    expect(core.active).toBe(true);
    expect(wl.request).toHaveBeenCalledTimes(0);

    setVisibility("visible");
    await flush();
    expect(core.held).toBe(true);
    expect(wl.request).toHaveBeenCalledTimes(1);
  });

  it("② 非表示中の OS 自動解放後、表示復帰でロックを再取得する（active は維持）", async () => {
    const core = makeCore();
    await core.request();
    expect(core.held).toBe(true);
    const first = wl.last()!;

    // タブ非表示 → OS による自動解放。非表示中は再取得しない（②に委ねる）。
    setVisibility("hidden");
    first.autoRelease();
    await flush();
    expect(core.held).toBe(false);
    expect(core.active).toBe(true); // 望みは生きている
    expect(wl.request).toHaveBeenCalledTimes(1); // 非表示中は再取得しない

    // 表示復帰 → 再取得。
    setVisibility("visible");
    await flush();
    expect(core.held).toBe(true);
    expect(wl.request).toHaveBeenCalledTimes(2);
    expect(wl.last()).not.toBe(first);
  });

  it("非表示への visibilitychange では再取得しない", async () => {
    const core = makeCore();
    await core.request();
    setVisibility("hidden"); // 先に非表示にしてから OS 解放
    wl.last()!.autoRelease();
    setVisibility("hidden"); // 非表示→非表示の visibilitychange
    await flush();
    expect(core.held).toBe(false);
    expect(wl.request).toHaveBeenCalledTimes(1);
  });

  it("request 失敗は error プロパティに正規化され held=false（never-reject）", async () => {
    wl.restore();
    const failing = installWakeLock({ reject: new Error("denied") });
    const core = makeCore();
    await expect(core.request()).resolves.toBeUndefined();
    expect(core.held).toBe(false);
    expect(core.error).toBeInstanceOf(Error);
    expect(core.error?.message).toBe("denied");
    failing.restore();
    wl = installWakeLock();
  });

  it("Error でない reject 値も Error に正規化される", async () => {
    wl.restore();
    const failing = installWakeLock({ reject: "boom" });
    const core = makeCore();
    await core.request();
    expect(core.error).toBeInstanceOf(Error);
    expect(core.error?.message).toBe("boom");
    failing.restore();
    wl = installWakeLock();
  });

  it("拒否環境で可視復帰を繰り返しても、同一原因の error は重複発火しない", async () => {
    wl.restore();
    // 実 API 同様、毎回新しい Error インスタンスで reject する。
    const failing = installWakeLock({ rejectFactory: () => new Error("denied") });
    const target = new EventTarget();
    const core = makeCore(target);
    const onError = vi.fn();
    target.addEventListener("wcs-wakelock:error", onError);

    await core.request(); // 1回目失敗 → error 発火
    setVisibility("visible");
    await flush(); // 再試行・再失敗だが同一原因 → 発火しない
    setVisibility("visible");
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(core.held).toBe(false);
    expect(core.error?.message).toBe("denied");
    failing.restore();
    wl = installWakeLock();
  });

  it("原因が変わる失敗は error を再発火する", async () => {
    wl.restore();
    let n = 0;
    const failing = installWakeLock({ rejectFactory: () => new Error(n++ === 0 ? "a" : "b") });
    const target = new EventTarget();
    const core = makeCore(target);
    const onError = vi.fn();
    target.addEventListener("wcs-wakelock:error", onError);

    await core.request(); // "a"
    setVisibility("visible");
    await flush(); // "b" → 原因が変わったので再発火

    expect(onError).toHaveBeenCalledTimes(2);
    expect(core.error?.message).toBe("b");
    failing.restore();
    wl = installWakeLock();
  });

  it("成功取得で過去の error はクリアされる", async () => {
    wl.restore();
    const failing = installWakeLock({ reject: new Error("x") });
    const core = makeCore();
    await core.request();
    expect(core.error).toBeInstanceOf(Error);
    failing.restore();

    wl = installWakeLock();
    core.release();
    await core.request();
    expect(core.error).toBeNull();
    expect(core.held).toBe(true);
  });

  it("レースガード: 取得 await 中に release されたら、遅延 resolve した sentinel を破棄する", async () => {
    wl.restore();
    const deferred = installWakeLock({ deferred: true });
    const core = makeCore();
    const p = core.request(); // pending
    core.release(); // gen を進める
    deferred.resolveNext(); // 遅れて sentinel が解決
    await p;
    const sentinel = deferred.sentinels[0];
    expect(sentinel.release).toHaveBeenCalledTimes(1); // 破棄された
    expect(core.held).toBe(false);
    deferred.restore();
    wl = installWakeLock();
  });

  it("レースガード: 取得 await 中に release されたら、遅延 reject の error は無視する", async () => {
    wl.restore();
    const deferred = installWakeLock({ deferred: true });
    const core = makeCore();
    const p = core.request();
    core.release(); // gen を進める
    deferred.rejectNext(new Error("late"));
    await p;
    expect(core.error).toBeNull(); // 旧失敗で上書きしない
    expect(core.held).toBe(false);
    deferred.restore();
    wl = installWakeLock();
  });

  it("sentinel.release() が reject しても release() は never-throw", async () => {
    wl.restore();
    const rejecting = installWakeLock({ rejectRelease: true });
    const core = makeCore();
    await core.request();
    expect(() => core.release()).not.toThrow();
    expect(core.held).toBe(false);
    await flush(); // 破棄の reject を握り潰すマイクロタスクを流す
    rejecting.restore();
    wl = installWakeLock();
  });

  it("レースガード破棄で sentinel.release() が reject しても握り潰す", async () => {
    wl.restore();
    const deferred = installWakeLock({ deferred: true, rejectRelease: true });
    const core = makeCore();
    const p = core.request();
    core.release(); // gen を進める
    deferred.resolveNext(); // 遅延 resolve → 破棄パスで release() が reject
    await p;
    await flush();
    expect(core.held).toBe(false);
    deferred.restore();
    wl = installWakeLock();
  });

  it("取得 await 中の再 acquire は in-flight ガードで no-op（request は1回のみ）", async () => {
    wl.restore();
    const deferred = installWakeLock({ deferred: true });
    const core = makeCore();
    const p = core.request(); // _acquire が await 中（in-flight）
    // 表示復帰イベントを連続発火させ、in-flight 中の再 acquire を誘発する。
    // _acquiring ガードが無ければ複数回 request() が呼ばれてしまう。
    setVisibility("visible");
    setVisibility("visible");
    expect(wl.request).toHaveBeenCalledTimes(0); // deferred 側で計上
    expect(deferred.request).toHaveBeenCalledTimes(1); // 二重呼び出しされていない

    deferred.resolveNext();
    await p;
    await flush();
    expect(core.held).toBe(true);
    expect(deferred.request).toHaveBeenCalledTimes(1); // 解決後も1回のまま
    deferred.restore();
    wl = installWakeLock();
  });

  it("in-flight 解決後は次の acquire が再度可能（ガードがスタックしない）", async () => {
    wl.restore();
    const deferred = installWakeLock({ deferred: true });
    const core = makeCore();
    const p = core.request();
    core.release(); // await 中に release → gen 進行・supersede
    deferred.resolveNext(); // 遅延 resolve → 破棄され _acquiring は finally で解除
    await p;
    await flush();
    expect(core.held).toBe(false);

    // ガードが解除されているので、次の request は正常に取得できる。
    const p2 = core.request();
    deferred.resolveNext();
    await p2;
    await flush();
    expect(core.held).toBe(true);
    expect(deferred.request).toHaveBeenCalledTimes(2);
    deferred.restore();
    wl = installWakeLock();
  });

  it("退行回帰: acquire#1 pending 中に release→request 重なり後、解決後 held=true に収束する", async () => {
    wl.restore();
    const deferred = installWakeLock({ deferred: true });
    const core = makeCore();
    const p = core.request(); // #1 pending（_acquiring=true, gen=1）
    core.release(); // _active=false, gen=2
    core.request(); // #2: in-flight ガードで no-op。意図は active=true に戻る
    expect(deferred.request).toHaveBeenCalledTimes(1); // 二重 request していない

    deferred.resolveNext(); // #1 解決 → stale gen で破棄 → 意図が生きているので retry
    await p;
    await flush();
    // retry が #2 相当の acquire を開始したので request は2回目が発行される。
    expect(deferred.request).toHaveBeenCalledTimes(2);
    deferred.resolveNext(); // retry の acquire を解決
    await flush();

    expect(core.held).toBe(true); // desired=true なら最終的にロック保持
    expect(core.active).toBe(true);
    deferred.restore();
    wl = installWakeLock();
  });

  it("退行回帰: 拒否(deferred)環境で重なりトグルしても再帰暴走しない", async () => {
    wl.restore();
    const deferred = installWakeLock({ deferred: true });
    const core = makeCore();
    const p = core.request(); // #1 pending, gen=1
    core.release(); // gen=2
    core.request(); // #2: ガードで no-op、意図 active=true
    deferred.rejectNext(new Error("denied")); // #1 を reject → stale gen → retry
    await p;
    await flush();
    // retry が新しい acquire を1つだけ開始（暴走しない）。
    expect(deferred.request).toHaveBeenCalledTimes(2);
    deferred.rejectNext(new Error("denied")); // retry も reject（今度は live なので error 記録）
    await flush();
    expect(core.held).toBe(false);
    expect(core.error).toBeInstanceOf(Error);
    expect(deferred.request).toHaveBeenCalledTimes(2); // これ以上は増えない
    deferred.restore();
    wl = installWakeLock();
  });

  it("クロバー回帰: reject-retry の in-flight ウィンドウ中の同時再入でも request は二重発行されない", async () => {
    wl.restore();
    const deferred = installWakeLock({ deferred: true });
    const core = makeCore();
    const p = core.request(); // #1 pending（_acquiring=true, gen=1）
    core.release(); // gen=2
    core.request(); // #2: ガード no-op、意図 active=true
    expect(deferred.request).toHaveBeenCalledTimes(1);

    // #1 を reject → stale gen → finally で _acquiring=false → retry が #3 を開始し
    // _acquiring=true で pending（このフラグが finally でクロバーされていないことが要点）。
    deferred.rejectNext(new Error("denied"));
    await p;
    await flush();
    expect(deferred.request).toHaveBeenCalledTimes(2); // retry の acquire が in-flight

    // retry が in-flight な「窓」の最中に別契機（visibilitychange）で再入させる。
    // クロバーがあれば _acquiring=false で素通りし request が3回目になってしまう。
    setVisibility("visible");
    setVisibility("visible");
    await flush();
    expect(deferred.request).toHaveBeenCalledTimes(2); // ガードが効いており増えない

    // retry を解決すると最終的に held=true へ収束する。
    deferred.resolveNext();
    await flush();
    expect(core.held).toBe(true);
    expect(deferred.request).toHaveBeenCalledTimes(2);
    deferred.restore();
    wl = installWakeLock();
  });

  it("dispose() で visibilitychange を解除し、以後は再取得しない", async () => {
    const core = makeCore();
    await core.request();
    const sentinel = wl.last()!;
    core.dispose();
    expect(core.held).toBe(false);
    expect(sentinel.release).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await Promise.resolve();
    expect(wl.request).toHaveBeenCalledTimes(1); // リスナ解除済みで増えない
  });

  it("request 前の dispose は no-op（リスナ未登録・held は false のまま）", () => {
    const core = makeCore();
    expect(() => core.dispose()).not.toThrow();
    expect(core.held).toBe(false);
  });

  it("type の getter/setter（既定 screen）", () => {
    const core = makeCore();
    expect(core.type).toBe("screen");
    core.type = "screen";
    expect(core.type).toBe("screen");
  });

  it("held 中の type 変更は live sentinel を再取得しない（次の acquire まで反映されない）", async () => {
    const core = makeCore();
    await core.request();
    expect(core.held).toBe(true);
    const heldSentinel = wl.last()!;
    expect(wl.request).toHaveBeenCalledTimes(1);

    // 保持中に type を変更しても再取得は走らない（同じ sentinel を保持し続ける）。
    core.type = "screen";
    await flush();
    expect(wl.request).toHaveBeenCalledTimes(1); // 再 request されていない
    expect(core.held).toBe(true);
    expect(heldSentinel.release).not.toHaveBeenCalled(); // live sentinel はそのまま
  });

  it("多段 supersede（pending 中に release→request を2巡）でも最終的に held=true へ収束する", async () => {
    wl.restore();
    const deferred = installWakeLock({ deferred: true });
    const core = makeCore();
    const p = core.request(); // #1 pending, gen=1, _acquiring=true
    // 1巡目: release→request（in-flight ガードで no-op）
    core.release(); // gen=2
    core.request(); // ガード no-op, active=true
    // 2巡目: さらに release→request（依然 in-flight）
    core.release(); // gen=3
    core.request(); // ガード no-op, active=true
    expect(deferred.request).toHaveBeenCalledTimes(1); // まだ二重 request していない

    deferred.resolveNext(); // #1 解決 → stale gen → retry が1回走る
    await p;
    await flush();
    expect(deferred.request).toHaveBeenCalledTimes(2); // retry の acquire

    deferred.resolveNext(); // retry を解決
    await flush();
    expect(core.held).toBe(true); // 多段 supersede でも desired に収束
    expect(core.active).toBe(true);
    expect(deferred.request).toHaveBeenCalledTimes(2); // 暴走せず有界
    deferred.restore();
    wl = installWakeLock();
  });

  it("可視のままの OS 解放（visibilitychange 無し）でも held=true に自動復帰する（リース更新）", async () => {
    // バッテリー低下/省電力など、可視性変化を伴わない OS 解放のモデル。
    const core = makeCore();
    await core.request();
    expect(core.held).toBe(true);
    const first = wl.last()!;
    expect(wl.request).toHaveBeenCalledTimes(1);

    // setVisibility を呼ばず（＝visibilitychange を飛ばさず）に解放だけ起こす。
    first.autoRelease();
    await flush();

    // _onRelease 起点の再取得が1回走り、held=true に復帰する。
    expect(core.held).toBe(true);
    expect(core.active).toBe(true);
    expect(wl.request).toHaveBeenCalledTimes(2); // 再取得は1回だけ
    expect(wl.last()).not.toBe(first); // 新しい sentinel を保持
  });

  it("可視中の解放→再取得が reject されたら error 記録・held=false で静止し暴走しない", async () => {
    // 1回目は成功し、その後の再取得（_onRelease 起点）は失敗する環境を作る。
    const core = makeCore();
    await core.request();
    expect(core.held).toBe(true);
    const first = wl.last()!;

    // 以後の request を拒否環境に差し替える。
    wl.restore();
    const denying = installWakeLock({ reject: new Error("denied") });

    // 可視のまま解放 → 再取得が走るが reject → live failure パスで静止。
    first.autoRelease();
    await flush();
    await flush();

    expect(core.held).toBe(false); // 取得できない
    expect(core.error).toBeInstanceOf(Error);
    expect(core.error?.message).toBe("denied");
    // 失敗は _onRelease を再発火しない（sentinel 未取得・リスナ未装着）ので有界。
    expect(denying.request).toHaveBeenCalledTimes(1);
    denying.restore();
    wl = installWakeLock();
  });

  it("可視中の解放後でも release() 済みなら再取得しない（desired=false を尊重）", async () => {
    const core = makeCore();
    await core.request();
    const first = wl.last()!;
    core.release(); // desired=false、リスナ除去済み
    expect(first.release).toHaveBeenCalledTimes(1);
    // 明示 release 済みなので _onRelease は走らず、再取得もしない。
    await flush();
    expect(core.held).toBe(false);
    expect(wl.request).toHaveBeenCalledTimes(1);
  });

  it("コンストラクタで type を指定でき、request に渡る", async () => {
    const core = makeCore(undefined, "screen");
    await core.request();
    expect(wl.request).toHaveBeenCalledWith("screen");
  });

  it("ready は即時 resolve する Promise を返す（同期 sink なのでプローブ無し）", async () => {
    const core = makeCore();
    await expect(core.ready).resolves.toBeUndefined();
  });

  it("observe() は ready（即時 resolve）を返し、冪等に同じ Promise を返す", async () => {
    const core = makeCore();
    const p1 = core.observe();
    const p2 = core.observe();
    expect(p1).toBe(core.ready);
    expect(p2).toBe(p1); // 冪等：呼ぶたび同じ ready を返す
    await expect(p1).resolves.toBeUndefined();
  });

  it("observe() はモニタリングを確立しない no-op（request は呼ばれない）", async () => {
    const core = makeCore();
    await core.observe();
    expect(core.held).toBe(false);
    expect(wl.request).toHaveBeenCalledTimes(0);
  });

  describe("errorInfo taxonomy (Phase 6)", () => {
    it("初期状態の errorInfo は null", () => {
      expect(makeCore().errorInfo).toBeNull();
    });

    it("errorInfo は wcBindable property(error の直後)として宣言される", () => {
      const names = WakeLockCore.wcBindable.properties.map((p) => p.name);
      expect(names).toContain("errorInfo");
      expect(names.indexOf("errorInfo")).toBe(names.indexOf("error") + 1);
    });

    it("NotAllowedError → not-allowed / start / recoverable=false（公開 error shape は不変）", async () => {
      wl.restore();
      // 実 API は取得拒否時に NotAllowedError で reject する（ページ非可視 / permission）。
      const denied = new Error("page not visible");
      denied.name = "NotAllowedError";
      const failing = installWakeLock({ reject: denied });
      const core = makeCore();
      await core.request();
      expect(core.errorInfo).toEqual({
        code: "not-allowed", phase: "start", recoverable: false, message: "page not visible",
      });
      // 公開 error プロパティは生の Error のまま（taxonomy は additive）。
      expect(core.error).toBe(denied);
      failing.restore();
      wl = installWakeLock();
    });

    it("その他の Error → wakelock-error / execute / recoverable=false", async () => {
      wl.restore();
      // 非 Error reject は Core が Error(name="Error")に正規化する → else 分岐。
      const failing = installWakeLock({ reject: "boom" });
      const core = makeCore();
      await core.request();
      expect(core.errorInfo).toEqual({
        code: "wakelock-error", phase: "execute", recoverable: false, message: "boom",
      });
      failing.restore();
      wl = installWakeLock();
    });

    it("成功取得で error が null にクリアされると errorInfo も null になる（error と同期）", async () => {
      wl.restore();
      const failing = installWakeLock({ reject: new Error("x") });
      const core = makeCore();
      await core.request();
      expect(core.errorInfo).not.toBeNull();
      failing.restore();

      // 成功環境へ差し替えて再取得 → error/errorInfo ともに null にクリアされる。
      wl = installWakeLock();
      core.release();
      await core.request();
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
      expect(core.held).toBe(true);
    });

    it("errorInfo は error と同期して遷移し、error より前に error-info-changed が流れる", async () => {
      wl.restore();
      const failing = installWakeLock({ reject: new Error("denied") });
      const target = new EventTarget();
      const core = makeCore(target);
      const order: string[] = [];
      target.addEventListener("wcs-wakelock:error-info-changed", () => order.push("errorInfo"));
      target.addEventListener("wcs-wakelock:error", () => order.push("error"));
      await core.request();
      expect(order).toEqual(["errorInfo", "error"]);
      expect(core.errorInfo).not.toBeNull();
      failing.restore();
      wl = installWakeLock();
    });
  });
});
