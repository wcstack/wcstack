import { describe, it, expect, vi, afterEach } from "vitest";
import { GeolocationCore } from "../src/core/GeolocationCore";
import {
  installGeolocation, removeGeolocation, installPermissions, removePermissions, makePosition,
} from "./mocks";

// Flush pending microtasks/macrotasks so the geolocation/permission callbacks
// (resolved on Promise.resolve().then / setTimeout) run before assertions.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("GeolocationCore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    removeGeolocation();
    removePermissions();
  });

  it("EventTargetを継承している", () => {
    removePermissions();
    const core = new GeolocationCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  it("初期状態は position/座標系が null、watching/loading が false", () => {
    removePermissions();
    const core = new GeolocationCore();
    expect(core.position).toBeNull();
    expect(core.latitude).toBeNull();
    expect(core.longitude).toBeNull();
    expect(core.accuracy).toBeNull();
    expect(core.coords).toBeNull();
    expect(core.timestamp).toBeNull();
    expect(core.watching).toBe(false);
    expect(core.loading).toBe(false);
    expect(core.error).toBeNull();
  });

  it("getCurrentPosition 成功で position を正規化して公開し loading をトグルする", async () => {
    installGeolocation({ position: makePosition({ latitude: 1, longitude: 2, accuracy: 3, timestamp: 5000 }) });
    removePermissions();
    const core = new GeolocationCore();

    const loadings: boolean[] = [];
    core.addEventListener("wcs-geo:loading-changed", (e) => loadings.push((e as CustomEvent).detail));

    const p = core.getCurrentPosition();
    expect(core.loading).toBe(true);
    await p;

    expect(core.loading).toBe(false);
    expect(loadings).toEqual([true, false]);
    expect(core.latitude).toBe(1);
    expect(core.longitude).toBe(2);
    expect(core.accuracy).toBe(3);
    expect(core.timestamp).toBe(5000);
    expect(core.coords).toEqual({
      latitude: 1, longitude: 2, accuracy: 3,
      altitude: null, altitudeAccuracy: null, heading: null, speed: null,
    });
    expect(core.position!.coords).toEqual(core.coords);
  });

  it("getCurrentPosition は wcs-geo:position と派生 getter を同一イベントから出す", async () => {
    installGeolocation({ position: makePosition({ latitude: 10, longitude: 20 }) });
    removePermissions();
    const core = new GeolocationCore();

    const latProp = GeolocationCore.wcBindable.properties.find((p) => p.name === "latitude")!;
    const lngProp = GeolocationCore.wcBindable.properties.find((p) => p.name === "longitude")!;
    let captured: Event | null = null;
    core.addEventListener("wcs-geo:position", (e) => { captured = e; });

    await core.getCurrentPosition();

    expect(captured).not.toBeNull();
    expect(latProp.getter!(captured!)).toBe(10);
    expect(lngProp.getter!(captured!)).toBe(20);
  });

  it("getCurrentPosition 失敗で error を正規化して公開する（reject しない）", async () => {
    installGeolocation({ error: { code: 1, message: "denied" } });
    removePermissions();
    const core = new GeolocationCore();

    const errors: any[] = [];
    core.addEventListener("wcs-geo:error", (e) => errors.push((e as CustomEvent).detail));

    await expect(core.getCurrentPosition()).resolves.toBeUndefined();
    expect(core.loading).toBe(false);
    expect(core.error).toEqual({ code: 1, message: "denied" });
    // 取得開始時の error クリア(null)は初期値も null なので同値ガードで抑止され、
    // 失敗(error)の1回だけが発火する
    expect(errors).toEqual([{ code: 1, message: "denied" }]);
  });

  it("取得中に再度 getCurrentPosition しても loading は二重トグルしない", async () => {
    installGeolocation({ position: makePosition() });
    removePermissions();
    const core = new GeolocationCore();

    const loadings: boolean[] = [];
    core.addEventListener("wcs-geo:loading-changed", (e) => loadings.push((e as CustomEvent).detail));

    const p1 = core.getCurrentPosition();
    const p2 = core.getCurrentPosition(); // 既に loading=true → 同値で何も出さない
    expect(core.loading).toBe(true);
    await Promise.all([p1, p2]);

    // true は1回だけ、false は最後に出る（同値の重複発火が無い）
    expect(loadings).toEqual([true, false]);
  });

  it("geolocation 非対応環境では getCurrentPosition が unsupported エラーを出す", async () => {
    removeGeolocation();
    removePermissions();
    const core = new GeolocationCore();

    await core.getCurrentPosition();
    expect(core.error).toEqual({ code: 2, message: "Geolocation API is not available in this environment." });
    expect(core.loading).toBe(false);
  });

  it("dispose 後に解決した一発取得のコールバックは状態を更新しない（世代ガード）", async () => {
    installGeolocation({ position: makePosition({ latitude: 50 }) });
    removePermissions();
    const core = new GeolocationCore();

    const events: string[] = [];
    core.addEventListener("wcs-geo:position", () => events.push("position"));

    const p = core.getCurrentPosition(); // 保留中（success は microtask で発火）
    core.dispose();                       // 解決前に dispose → 世代を無効化
    await p;                              // 解決するが stale なので bail

    // 切断済み要素上で position を dispatch しない / シャドウ値も更新しない
    expect(events).toEqual([]);
    expect(core.position).toBeNull();
    expect(core.latitude).toBeNull();
    // promise 自体は解決する（connectedCallbackPromise が hang しない）
    await expect(p).resolves.toBeUndefined();
  });

  it("dispose 後に解決した一発取得（失敗）のコールバックも error を更新しない", async () => {
    installGeolocation({ error: { code: 1, message: "denied" } });
    removePermissions();
    const core = new GeolocationCore();

    const errors: any[] = [];
    core.addEventListener("wcs-geo:error", (e) => errors.push((e as CustomEvent).detail));

    const p = core.getCurrentPosition();
    core.dispose();
    await p;

    // 取得開始時の _setError(null) は初期 null と同値で抑止、失敗側は stale で bail
    expect(errors).toEqual([]);
    expect(core.error).toBeNull();
  });

  it("dispose は進行中の loading をサイレントにリセットする（再接続後の true エッジを潰さない）", async () => {
    installGeolocation({ position: makePosition({ latitude: 1 }) });
    removePermissions();
    const core = new GeolocationCore();

    const loadings: boolean[] = [];
    core.addEventListener("wcs-geo:loading-changed", (e) => loadings.push((e as CustomEvent).detail));

    const p1 = core.getCurrentPosition();
    expect(core.loading).toBe(true);
    core.dispose(); // loading をサイレントに false に戻す（dispatch しない）
    expect(core.loading).toBe(false);
    await p1;

    // 再取得では true→false が正しく流れる（dispose 後にシャドウが false なので）
    const p2 = core.getCurrentPosition();
    await p2;
    // 1回目: true（dispose は無音）。2回目: true,false。
    expect(loadings).toEqual([true, true, false]);
  });

  it("成功コールバック内の normalize 例外でも promise は解決し error に倒れる", async () => {
    installGeolocation({ position: makePosition({ latitude: 1 }) });
    removePermissions();
    const core = new GeolocationCore();
    // _normalizePosition を throw させる（ブラウザ非同期コールバック内の例外を模擬）
    vi.spyOn(core as any, "_normalizePosition").mockImplementation(() => {
      throw new Error("boom");
    });

    const p = core.getCurrentPosition();
    expect(core.loading).toBe(true);
    // resolve が保証され、永久 pending にならない（unhandled rejection も出さない）
    await expect(p).resolves.toBeUndefined();
    expect(core.loading).toBe(false);
    // 例外は error として公開される
    expect(core.error).toEqual({ code: 2, message: "Unexpected error while processing the position fix." });
  });

  it("失敗コールバック内の normalize 例外でも promise は解決し error に倒れる", async () => {
    installGeolocation({ error: { code: 1, message: "denied" } });
    removePermissions();
    const core = new GeolocationCore();
    vi.spyOn(core as any, "_normalizeError").mockImplementation(() => {
      throw new Error("boom");
    });

    const p = core.getCurrentPosition();
    await expect(p).resolves.toBeUndefined();
    expect(core.loading).toBe(false);
    expect(core.error).toEqual({ code: 2, message: "Unexpected error while processing the position fix." });
  });

  it("watch は watchPosition を1度だけ張り、各 fix を position に流す", () => {
    const mock = installGeolocation();
    removePermissions();
    const core = new GeolocationCore();

    const watchings: boolean[] = [];
    core.addEventListener("wcs-geo:watching-changed", (e) => watchings.push((e as CustomEvent).detail));

    core.watch();
    expect(core.watching).toBe(true);
    core.watch(); // 二重 watch は無視
    expect(mock.watchPosition).toHaveBeenCalledTimes(1);

    mock.emitWatch(makePosition({ latitude: 7 }));
    expect(core.latitude).toBe(7);
    mock.emitWatch(makePosition({ latitude: 8 }));
    expect(core.latitude).toBe(8);

    expect(watchings).toEqual([true]);
  });

  it("watch 中のエラーは error に流れる", () => {
    const mock = installGeolocation();
    removePermissions();
    const core = new GeolocationCore();

    core.watch();
    mock.emitWatchError({ code: 3, message: "timeout" });
    expect(core.error).toEqual({ code: 3, message: "timeout" });
  });

  it("watch 中のエラー後に位置が回復すると error がクリアされる", () => {
    const mock = installGeolocation();
    removePermissions();
    const core = new GeolocationCore();

    const errors: any[] = [];
    core.addEventListener("wcs-geo:error", (e) => errors.push((e as CustomEvent).detail));

    core.watch();
    mock.emitWatchError({ code: 3, message: "timeout" });
    expect(core.error).toEqual({ code: 3, message: "timeout" });

    mock.emitWatch(makePosition({ latitude: 12 }));
    // 回復した fix が error を null に戻す
    expect(core.error).toBeNull();
    expect(core.latitude).toBe(12);
    // error(timeout) → null の2回だけ（初期 null→null は同値ガードで抑止）
    expect(errors).toEqual([{ code: 3, message: "timeout" }, null]);
  });

  it("既に error が null なら _setError(null) は重複発火しない（同値ガード）", () => {
    const mock = installGeolocation();
    removePermissions();
    const core = new GeolocationCore();

    const errors: any[] = [];
    core.addEventListener("wcs-geo:error", (e) => errors.push((e as CustomEvent).detail));

    core.watch();
    // 初期 error は null。成功 fix が _setError(null) を呼んでも同値なので発火しない。
    mock.emitWatch(makePosition({ latitude: 1 }));
    mock.emitWatch(makePosition({ latitude: 2 }));
    expect(errors).toEqual([]);
  });

  it("clearWatch 後にブラウザがキュー済み watch コールバックを発火しても状態を更新しない", () => {
    const mock = installGeolocation();
    removePermissions();
    const core = new GeolocationCore();

    const positions: any[] = [];
    const errors: any[] = [];
    core.addEventListener("wcs-geo:position", (e) => positions.push((e as CustomEvent).detail));
    core.addEventListener("wcs-geo:error", (e) => errors.push((e as CustomEvent).detail));

    core.watch();
    core.clearWatch(); // watchId を null に

    // 解除後に遅延して届く success / error コールバックは無視される
    mock.emitWatch(makePosition({ latitude: 99 }));
    mock.emitWatchError({ code: 3, message: "timeout" });
    expect(positions).toEqual([]);
    expect(errors).toEqual([]);
    expect(core.position).toBeNull();
    expect(core.error).toBeNull();
  });

  it("clearWatch→watch 再開後、旧 watch のキュー済みコールバックは無視される（世代ガード）", () => {
    const mock = installGeolocation();
    removePermissions();
    const core = new GeolocationCore();

    const positions: number[] = [];
    const errors: any[] = [];
    core.addEventListener("wcs-geo:position", (e) => positions.push((e as CustomEvent).detail.latitude));
    core.addEventListener("wcs-geo:error", (e) => errors.push((e as CustomEvent).detail));

    core.watch();      // watch#0 → watchId=1
    core.clearWatch(); // 解除
    core.watch();      // watch#1 → watchId=2（non-null に復帰）
    expect(mock.watchPosition).toHaveBeenCalledTimes(2);

    // 旧 watch#0 のキュー済みコールバックを遅延配送。_watchId は non-null だが
    // 世代が違うので無視される（live null チェックでは漏れていたケース）。
    mock.emitWatchOn(0, makePosition({ latitude: 11 }));
    mock.emitWatchErrorOn(0, { code: 3, message: "stale" });
    expect(positions).toEqual([]);
    expect(errors).toEqual([]);
    expect(core.position).toBeNull();

    // 現行 watch#1 の fix は正しく反映される。
    mock.emitWatchOn(1, makePosition({ latitude: 22 }));
    expect(positions).toEqual([22]);
    expect(core.latitude).toBe(22);
  });

  it("dispose 後にブラウザがキュー済み watch コールバックを発火しても状態を更新しない", () => {
    const mock = installGeolocation();
    removePermissions();
    const core = new GeolocationCore();

    const positions: any[] = [];
    core.addEventListener("wcs-geo:position", (e) => positions.push((e as CustomEvent).detail));

    core.watch();
    core.dispose(); // clearWatch を経ない直接 dispose でも世代を無効化

    mock.emitWatch(makePosition({ latitude: 5 }));
    expect(positions).toEqual([]);
    expect(core.position).toBeNull();
  });

  it("watch 成功コールバック内の normalize 例外でも error に倒れる", () => {
    const mock = installGeolocation();
    removePermissions();
    const core = new GeolocationCore();
    vi.spyOn(core as any, "_normalizePosition").mockImplementation(() => {
      throw new Error("boom");
    });

    core.watch();
    mock.emitWatch(makePosition({ latitude: 1 }));
    expect(core.error).toEqual({ code: 2, message: "Unexpected error while processing the position fix." });
  });

  it("watch 失敗コールバック内の normalize 例外でも error に倒れる", () => {
    const mock = installGeolocation();
    removePermissions();
    const core = new GeolocationCore();
    vi.spyOn(core as any, "_normalizeError").mockImplementation(() => {
      throw new Error("boom");
    });

    core.watch();
    mock.emitWatchError({ code: 3, message: "timeout" });
    expect(core.error).toEqual({ code: 2, message: "Unexpected error while processing the position fix." });
  });

  it("clearWatch は watchPosition を解除し watching を false にする", () => {
    const mock = installGeolocation();
    removePermissions();
    const core = new GeolocationCore();

    core.watch();
    core.clearWatch();
    expect(mock.clearWatch).toHaveBeenCalledTimes(1);
    expect(core.watching).toBe(false);

    // 未 watch 状態での clearWatch は clearWatch を呼ばない（watchId が null）
    core.clearWatch();
    expect(mock.clearWatch).toHaveBeenCalledTimes(1);
  });

  it("geolocation 非対応環境では watch が unsupported エラーを出し watching は false のまま", () => {
    removeGeolocation();
    removePermissions();
    const core = new GeolocationCore();

    core.watch();
    expect(core.watching).toBe(false);
    expect(core.error).toEqual({ code: 2, message: "Geolocation API is not available in this environment." });
  });

  it("permission を Permissions API から取得し change を購読する", async () => {
    removeGeolocation();
    const status = installPermissions({ state: "granted" });
    const core = new GeolocationCore();

    const states: string[] = [];
    core.addEventListener("wcs-geo:permission-changed", (e) => states.push((e as CustomEvent).detail));

    await flush();
    expect(core.permission).toBe("granted");

    status.change("denied");
    expect(core.permission).toBe("denied");
    expect(states).toEqual(["granted", "denied"]);
  });

  it("Permissions API 非対応なら permission は unsupported", async () => {
    removeGeolocation();
    removePermissions();
    const core = new GeolocationCore();
    await flush();
    expect(core.permission).toBe("unsupported");
  });

  it("granted 観測後に Permissions API を失った状態で reinit すると unsupported 遷移を通知する", async () => {
    removeGeolocation();
    installPermissions({ state: "granted" });
    const core = new GeolocationCore();
    await flush();
    expect(core.permission).toBe("granted");

    const states: string[] = [];
    core.addEventListener("wcs-geo:permission-changed", (e) => states.push((e as CustomEvent).detail));

    // 環境から Permissions API が消えた状態で再初期化（早期 return 経路）
    core.dispose();
    removePermissions();
    core.reinitPermission();

    // 直接代入ではなく _setPermission 経由なので granted→unsupported が通知される
    expect(core.permission).toBe("unsupported");
    expect(states).toEqual(["unsupported"]);
  });

  it("permissions.query が関数でない場合も unsupported", async () => {
    removeGeolocation();
    Object.defineProperty(navigator, "permissions", {
      value: {}, configurable: true, writable: true,
    });
    const core = new GeolocationCore();
    await flush();
    expect(core.permission).toBe("unsupported");
  });

  it("permissions.query が reject した場合は unsupported に落とす", async () => {
    removeGeolocation();
    installPermissions({ reject: true });
    const core = new GeolocationCore();
    await flush();
    expect(core.permission).toBe("unsupported");
  });

  it("reinitPermission は dispose 後に change 購読を張り直す（再接続相当）", async () => {
    removeGeolocation();
    const status = installPermissions({ state: "prompt" });
    const core = new GeolocationCore();
    await flush();
    expect(core.permission).toBe("prompt");

    core.dispose();
    core.reinitPermission(); // 再接続: 購読を張り直す
    await flush();

    status.change("granted");
    expect(core.permission).toBe("granted");
  });

  it("reinitPermission は購読が生きている間は二重購読しない（初回接続相当）", async () => {
    removeGeolocation();
    const status = installPermissions({ state: "prompt" });
    const core = new GeolocationCore();
    await flush();

    const states: string[] = [];
    core.addEventListener("wcs-geo:permission-changed", (e) => states.push((e as CustomEvent).detail));

    core.reinitPermission(); // 既に購読済み → no-op（二重購読しない）
    await flush();
    status.change("denied");
    // 二重購読なら denied が2回流れる。単一購読なので1回。
    expect(states).toEqual(["denied"]);
  });

  it("購読確立前に dispose されたら change を購読しない", async () => {
    removeGeolocation();
    const status = installPermissions({ state: "granted" });
    const core = new GeolocationCore();
    core.dispose(); // query 解決前に dispose
    await flush();

    // 解決した query は購読を張らず、permission は既定 prompt のまま
    expect(core.permission).toBe("prompt");
    status.change("denied");
    expect(core.permission).toBe("prompt");
  });

  it("query 解決前の同期 reparent でも最新の query だけを購読する（世代ガード）", async () => {
    removeGeolocation();
    // 実ブラウザ同様、query 毎に別の PermissionStatus を返す
    const perm = installPermissions({ state: "prompt", distinctPerQuery: true });

    const core = new GeolocationCore(); // query#1 発行（保留）
    core.dispose();                     // 同期 disconnect
    core.reinitPermission();            // 同期 reconnect → query#2 発行（保留）
    await flush();                      // #1, #2 が解決

    // 古い query(#1=statuses[0]) の change は購読されておらず無視される
    perm.statuses[0].change("denied");
    expect(core.permission).toBe("prompt");
    // 最新 query(#2=statuses[1]) のみ追跡する → leak なし・stale 無視
    perm.statuses[1].change("granted");
    expect(core.permission).toBe("granted");
  });

  it("query が reject しても stale（dispose 済み世代）なら unsupported にしない", async () => {
    removeGeolocation();
    installPermissions({ reject: true });
    const core = new GeolocationCore(); // reject する query（保留）
    core.dispose();                     // 解決前に世代を無効化
    await flush();
    // stale な reject は捨てられ、permission は既定 prompt のまま
    expect(core.permission).toBe("prompt");
  });

  it("dispose で permission change の購読を解除する", async () => {
    removeGeolocation();
    const status = installPermissions({ state: "prompt" });
    const core = new GeolocationCore();
    await flush();

    core.dispose();
    status.change("granted");
    // 解除済みなので変化しない
    expect(core.permission).toBe("prompt");

    // 購読が無い状態での dispose も安全
    core.dispose();
  });

  it("target を渡すとそのターゲットにイベントを発火する", async () => {
    installGeolocation({ position: makePosition({ latitude: 99 }) });
    removePermissions();
    const target = new EventTarget();
    const core = new GeolocationCore(target);

    const lats: number[] = [];
    target.addEventListener("wcs-geo:position", (e) => lats.push((e as CustomEvent).detail.latitude));

    await core.getCurrentPosition();
    expect(lats).toEqual([99]);
  });

  it("wcBindable に位置系プロパティとコマンドが宣言されている", () => {
    const props = GeolocationCore.wcBindable.properties.map((p) => p.name);
    expect(props).toEqual([
      "position", "latitude", "longitude", "accuracy", "coords", "timestamp",
      "watching", "loading", "error", "permission",
    ]);
    const commands = (GeolocationCore.wcBindable.commands ?? []).map((c) => c.name);
    expect(commands).toEqual(["getCurrentPosition", "watch", "clearWatch"]);

    // 派生 getter は同一 position イベントから取り出す
    const ev = new CustomEvent("wcs-geo:position", {
      detail: { latitude: 1, longitude: 2, accuracy: 3, coords: { x: 1 }, timestamp: 4 },
    });
    const get = (name: string) => GeolocationCore.wcBindable.properties.find((p) => p.name === name)!.getter!;
    expect(get("latitude")(ev)).toBe(1);
    expect(get("longitude")(ev)).toBe(2);
    expect(get("accuracy")(ev)).toBe(3);
    expect(get("coords")(ev)).toEqual({ x: 1 });
    expect(get("timestamp")(ev)).toBe(4);
  });
});
