import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CameraCore } from "../src/core/CameraCore";
import {
  installMedia, InstalledMedia, FakeMediaStream, FakeMediaStreamTrack, flush,
} from "./helpers";

describe("CameraCore", () => {
  let media: InstalledMedia;

  beforeEach(() => {
    media = installMedia();
  });
  afterEach(() => {
    media.uninstall();
  });

  function capture(core: CameraCore, type: string): unknown[] {
    const seen: unknown[] = [];
    core.addEventListener(type, (e) => seen.push((e as CustomEvent).detail));
    return seen;
  }

  it("observe で camera permission を監視し prompt を publish する", async () => {
    const core = new CameraCore();
    await core.observe({});
    expect(core.permission).toBe("prompt");
  });

  it("start 成功で active=true・permission=granted・stream-ready(生ハンドル)・deviceId/devices を publish", async () => {
    const core = new CameraCore();
    const streamReady = capture(core, "wcs-camera:stream-ready");
    const stream = new FakeMediaStream("cam-stream");
    media.resolveWith(stream);

    await core.observe({});
    core.start();
    await flush();

    expect(core.active).toBe(true);
    expect(core.permission).toBe("granted");
    expect(core.deviceId).toBe("cam-1");
    expect(core.devices).toHaveLength(1);
    expect(core.error).toBeNull();
    // 生ハンドルは値ではなく event でのみ出る（参照同一）。
    expect(streamReady).toHaveLength(1);
    expect(streamReady[0]).toBe(stream);
  });

  it("audio 制約ありなら microphone も監視し、成功で audioPermission=granted", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("av", [
      new FakeMediaStreamTrack("video"),
      new FakeMediaStreamTrack("audio"),
    ]));
    await core.observe({ audio: true });
    expect(core.audioPermission).toBe("prompt");
    core.start();
    await flush();
    expect(core.audioPermission).toBe("granted");
  });

  it("audio 制約ありでも grant した stream に audio track が無ければ granted にしない（#1）", async () => {
    const core = new CameraCore();
    // video のみの stream（mic が付与されなかったケースを模す）。
    media.resolveWith(new FakeMediaStream("video-only", [new FakeMediaStreamTrack("video")]));
    await core.observe({ audio: true });
    expect(core.audioPermission).toBe("prompt");
    core.start();
    await flush();
    expect(core.active).toBe(true);
    // audio track 不在なので audioPermission は granted に上書きされず prompt のまま。
    expect(core.audioPermission).toBe("prompt");
  });

  it("NotAllowedError で permission=denied・error 設定・active=false（never-throw）", async () => {
    const core = new CameraCore();
    media.rejectWith("NotAllowedError", "denied by user");
    await core.observe({});
    core.start();
    await flush();
    expect(core.active).toBe(false);
    expect(core.permission).toBe("denied");
    expect(core.error?.name).toBe("NotAllowedError");
  });

  it("NotReadableError（デバイス使用中）は error に出るが permission は変えない", async () => {
    const core = new CameraCore();
    media.rejectWith("NotReadableError");
    await core.observe({});
    core.start();
    await flush();
    expect(core.error?.name).toBe("NotReadableError");
    expect(core.permission).not.toBe("denied");
  });

  it("mediaDevices 不在（非セキュアコンテキスト）は permission=unsupported", async () => {
    media.uninstall();
    media = installMedia({ noMediaDevices: true });
    const core = new CameraCore();
    await core.observe({});
    expect(core.permission).toBe("unsupported");
  });

  it("restart 世代ガード: 旧 getUserMedia の stream は stop され、新しい stream のみ採用", async () => {
    const core = new CameraCore();
    const streamA = new FakeMediaStream("A");
    const streamB = new FakeMediaStream("B");
    const streamReady = capture(core, "wcs-camera:stream-ready");
    await core.observe({});

    media.resolveWith(streamA);
    core.start();
    media.resolveWith(streamB);
    core.start(); // 直前の acquire を supersede
    await flush();

    // 旧 stream は orphan として stop、新 stream のみ stream-ready。
    expect(streamA.tracks[0].stopped).toBe(true);
    expect(streamReady[streamReady.length - 1]).toBe(streamB);
    expect(core.active).toBe(true);
  });

  it("track ended（OS 剥奪）で active=false・ended イベント・desired は維持→resume で再取得", async () => {
    const core = new CameraCore();
    const stream = new FakeMediaStream("live", [new FakeMediaStreamTrack("video")]);
    media.resolveWith(stream);
    const ended = capture(core, "wcs-camera:ended");
    await core.observe({});
    core.start();
    await flush();
    expect(core.active).toBe(true);

    stream.tracks[0].end();
    expect(core.active).toBe(false);
    expect(ended).toHaveLength(1);

    // desired は true のまま → resume で再取得。
    const stream2 = new FakeMediaStream("live2");
    media.resolveWith(stream2);
    core.resume();
    await flush();
    expect(core.active).toBe(true);
  });

  it("stop で全 track.stop()・active=false・desired 解除（resume しても再取得しない）", async () => {
    const core = new CameraCore();
    const stream = new FakeMediaStream("s");
    media.resolveWith(stream);
    await core.observe({});
    core.start();
    await flush();

    core.stop();
    expect(stream.tracks[0].stopped).toBe(true);
    expect(core.active).toBe(false);

    core.resume();
    await flush();
    expect(core.active).toBe(false); // desired=false なので再取得しない
  });

  it("suspend は track を止めるが desired を維持し、resume で再取得（visibility 用）", async () => {
    const core = new CameraCore();
    const stream = new FakeMediaStream("s1");
    media.resolveWith(stream);
    await core.observe({});
    core.start();
    await flush();

    core.suspend();
    expect(stream.tracks[0].stopped).toBe(true);
    expect(core.active).toBe(false);

    const stream2 = new FakeMediaStream("s2");
    media.resolveWith(stream2);
    core.resume();
    await flush();
    expect(core.active).toBe(true);
  });

  it("ページ非表示中に in-flight acquire が解決しても suspend を打ち消さない（競合・回帰 #1）", async () => {
    const core = new CameraCore();
    const stream = new FakeMediaStream("inflight");
    media.resolveWith(stream);
    await core.observe({});

    // start() で acquire を起動するが、解決前（_stream 未代入）に suspend する。
    core.start();
    core.suspend(); // page-hidden 相当。_gen を進めて in-flight acquire を supersede。
    await flush();

    // acquire の解決した stream は orphan として stop され、active は立たない。
    expect(stream.tracks[0].stopped).toBe(true);
    expect(core.active).toBe(false);

    // desired は維持されているので resume で再取得できる。
    const stream2 = new FakeMediaStream("resumed");
    media.resolveWith(stream2);
    core.resume();
    await flush();
    expect(core.active).toBe(true);
  });

  it("switchCamera は facingMode を反転し active なら再取得する", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("front"));
    await core.observe({ facingMode: "user" });
    core.start();
    await flush();
    media.control.calls.length = 0;

    media.resolveWith(new FakeMediaStream("back"));
    core.switchCamera();
    await flush();

    const last = media.control.calls[media.control.calls.length - 1];
    expect((last.video as MediaTrackConstraints).facingMode).toBe("environment");
  });

  it("permission の live change が permission に反映される", async () => {
    const core = new CameraCore();
    await core.observe({});
    expect(core.permission).toBe("prompt");
    media.control.permissionStatuses.get("camera")!.set("granted");
    expect(core.permission).toBe("granted");
  });

  it("Permissions API が descriptor を拒否しても getUserMedia 成否で granted に refine", async () => {
    media.control.rejectPermissionQuery = true;
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("s"));
    await core.observe({});
    // watcher は unsupported を報告
    expect(core.permission).toBe("unsupported");
    core.start();
    await flush();
    // getUserMedia 成功で granted に上書き
    expect(core.permission).toBe("granted");
  });

  it("devicechange でデバイス一覧を再取得する（ホットプラグ・回帰）", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("s"));
    await core.observe({});
    core.start();
    await flush();
    expect(core.devices[0].deviceId).toBe("cam-1");
    // USB カメラ抜き差しを模す。
    media.control.devices = [
      { deviceId: "cam-1", label: "Front", groupId: "g1", kind: "videoinput" } as MediaDeviceInfo,
      { deviceId: "cam-2", label: "USB Cam", groupId: "g2", kind: "videoinput" } as MediaDeviceInfo,
    ];
    media.emitDeviceChange();
    await flush();
    expect(core.devices).toHaveLength(2);
  });

  it("devicechange の enumerate が dispose 後に解決しても devices を更新しない", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("s"));
    await core.observe({});
    core.start();
    await flush();
    media.control.devices = [
      { deviceId: "cam-1", label: "A", groupId: "g1", kind: "videoinput" } as MediaDeviceInfo,
      { deviceId: "cam-2", label: "B", groupId: "g2", kind: "videoinput" } as MediaDeviceInfo,
    ];
    media.emitDeviceChange(); // handler が enumerate を起動（microtask 保留）
    core.dispose();           // 解決前に _subscribed=false
    await flush();
    expect(core.devices).toHaveLength(1); // 更新されない
  });

  it("mediaDevices が devicechange 非対応(addEventListener 無し)でも観測は成功する", async () => {
    delete (navigator.mediaDevices as unknown as { addEventListener?: unknown }).addEventListener;
    const core = new CameraCore();
    await core.observe({});
    expect(core.permission).toBe("prompt");
  });

  it("NotAllowedError 後は desired を落とし、visibility 復帰(resume)で再取得しない（回帰）", async () => {
    const core = new CameraCore();
    media.rejectWith("NotAllowedError");
    await core.observe({});
    core.start();
    await flush();
    expect(core.permission).toBe("denied");
    media.control.calls.length = 0;
    // hidden→visible 相当: resume は desired=false なので getUserMedia を呼ばない。
    core.resume();
    await flush();
    expect(media.control.calls).toHaveLength(0);
  });

  it("NotReadableError（一時障害）後は desired を維持し resume で再取得する", async () => {
    const core = new CameraCore();
    media.rejectWith("NotReadableError");
    await core.observe({});
    core.start();
    await flush();
    media.control.calls.length = 0;
    media.resolveWith(new FakeMediaStream("recovered"));
    core.resume(); // desired は維持 → 再取得
    await flush();
    expect(core.active).toBe(true);
  });

  it("dispose で全 track.stop()・再 dispatch しない", async () => {
    const core = new CameraCore();
    const stream = new FakeMediaStream("s");
    media.resolveWith(stream);
    await core.observe({});
    core.start();
    await flush();

    let activeChanges = 0;
    core.addEventListener("wcs-camera:active-changed", () => activeChanges++);
    core.dispose();
    expect(stream.tracks[0].stopped).toBe(true);
    // dispose の release は silent（dispatch しない）。
    expect(activeChanges).toBe(0);
  });

  it("observe 再呼び出しで audio 制約の付け外しに microphone watcher が追従する", async () => {
    const core = new CameraCore();
    await core.observe({});
    expect(core.audioPermission).toBeNull();
    await core.observe({ audio: true });
    expect(core.audioPermission).toBe("prompt");
    await core.observe({}); // audio を外す
    expect(core.audioPermission).toBeNull();
  });

  it("再 observe で audio を足すと ready 解決時に microphone の初期 query が完了している（#12）", async () => {
    const core = new CameraCore();
    await core.observe({}); // 最初は audio なし
    // 再 observe で audio を追加。返り値 ready を await するだけで初期 query が確定する。
    await core.observe({ audio: true });
    expect(core.audioPermission).toBe("prompt"); // null ではなく初期 query 済み
  });

  it("microphone の同一 state への live change は audioPermission の同値ガードで無音", async () => {
    const core = new CameraCore();
    await core.observe({ audio: true });
    expect(core.audioPermission).toBe("prompt");
    let changes = 0;
    core.addEventListener("wcs-camera:audio-permission-changed", () => changes++);
    // 既に "prompt" の状態で再び "prompt" を流す → _setAudioPermission の同値 return。
    media.control.permissionStatuses.get("microphone")!.set("prompt");
    expect(changes).toBe(0);
    // 別 state なら通知される（ガードが内容比較でなく値比較である確認）。
    media.control.permissionStatuses.get("microphone")!.set("granted");
    expect(changes).toBe(1);
  });

  it("dispose は mediaDevices が removeEventListener 非対応でも安全（#8・205）", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("s"));
    await core.observe({});
    core.start();
    await flush();
    // devicechange 解除 API が無い環境を模す → dispose の removeEventListener 分岐を踏む。
    delete (navigator.mediaDevices as unknown as { removeEventListener?: unknown }).removeEventListener;
    expect(() => core.dispose()).not.toThrow();
  });

  it("acquire 末尾の enumerate が dispose 後に解決しても devices を更新しない（#8・304）", async () => {
    const core = new CameraCore();
    media.resolveWith(new FakeMediaStream("s"));
    // enumerateDevices を手動制御して、stream-ready の後・enumerate 解決の前に dispose を割り込ませる。
    let release!: (devices: MediaDeviceInfo[]) => void;
    (navigator.mediaDevices as unknown as { enumerateDevices: () => Promise<MediaDeviceInfo[]> }).enumerateDevices =
      () => new Promise((resolve) => { release = resolve; });
    await core.observe({});
    core.start();
    await flush(); // getUserMedia 解決→active=true→stream-ready、enumerate は保留中
    expect(core.active).toBe(true);
    core.dispose(); // _gen を進め、保留中の enumerate を supersede
    release([
      { deviceId: "cam-2", label: "Late", groupId: "g2", kind: "videoinput" } as MediaDeviceInfo,
    ]);
    await flush();
    // gen が一致しないので _setDevices は呼ばれない。
    expect(core.devices).toEqual([]);
  });

  describe("errorInfo taxonomy (Phase 6)", () => {
    it("初期状態の errorInfo は null", () => {
      expect(new CameraCore().errorInfo).toBeNull();
    });

    it("errorInfo は wcBindable property(error の直後)として宣言される", () => {
      const names = CameraCore.wcBindable.properties.map((p) => p.name);
      expect(names).toContain("errorInfo");
      expect(names.indexOf("errorInfo")).toBe(names.indexOf("error") + 1);
    });

    it("mediaDevices 不在(unsupported)→ capability-missing / probe / recoverable=false", async () => {
      media.uninstall();
      media = installMedia({ noMediaDevices: true });
      const core = new CameraCore();
      await core.observe({});
      core.start();
      await flush();
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "probe", recoverable: false,
        message: "getUserMedia is not available (requires a secure context).",
      });
      // 公開 error shape は不変。
      expect(core.error?.name).toBe("unsupported");
    });

    it("NotAllowedError → not-allowed / start、SecurityError も同分類", async () => {
      const core = new CameraCore();
      media.rejectWith("NotAllowedError", "denied by user");
      await core.observe({});
      core.start();
      await flush();
      expect(core.errorInfo).toEqual({ code: "not-allowed", phase: "start", recoverable: false, message: "denied by user" });

      const core2 = new CameraCore();
      media.rejectWith("SecurityError", "policy block");
      await core2.observe({});
      core2.start();
      await flush();
      expect(core2.errorInfo?.code).toBe("not-allowed");
    });

    it("NotFoundError → not-found / start", async () => {
      const core = new CameraCore();
      media.rejectWith("NotFoundError", "no camera");
      await core.observe({});
      core.start();
      await flush();
      expect(core.errorInfo).toEqual({ code: "not-found", phase: "start", recoverable: false, message: "no camera" });
    });

    it("NotReadableError → not-readable / start", async () => {
      const core = new CameraCore();
      media.rejectWith("NotReadableError", "device busy");
      await core.observe({});
      core.start();
      await flush();
      expect(core.errorInfo).toEqual({ code: "not-readable", phase: "start", recoverable: false, message: "device busy" });
    });

    it("OverconstrainedError → invalid-argument / start", async () => {
      const core = new CameraCore();
      media.rejectWith("OverconstrainedError", "unsatisfiable");
      await core.observe({});
      core.start();
      await flush();
      expect(core.errorInfo).toEqual({ code: "invalid-argument", phase: "start", recoverable: false, message: "unsatisfiable" });
    });

    it("AbortError → aborted / execute / recoverable=true", async () => {
      const core = new CameraCore();
      media.rejectWith("AbortError", "interrupted");
      await core.observe({});
      core.start();
      await flush();
      expect(core.errorInfo).toEqual({ code: "aborted", phase: "execute", recoverable: true, message: "interrupted" });
    });

    it("errorInfo は error と同期して遷移し、error より前に error-info-changed が流れる", async () => {
      const core = new CameraCore();
      media.rejectWith("NotReadableError", "x");
      await core.observe({});
      const order: string[] = [];
      core.addEventListener("wcs-camera:error-info-changed", () => order.push("errorInfo"));
      core.addEventListener("wcs-camera:error", () => order.push("error"));
      core.start();
      await flush();
      expect(order).toEqual(["errorInfo", "error"]);
      expect(core.errorInfo).not.toBeNull();
    });

    it("成功で error が null にクリアされると errorInfo も null になる(clear 経路)", async () => {
      const core = new CameraCore();
      media.rejectWith("NotReadableError", "transient");
      await core.observe({});
      core.start();
      await flush();
      expect(core.errorInfo).not.toBeNull();
      // NotReadableError は desired を維持するので resume で再取得 → 成功で _setError(null)。
      media.resolveWith(new FakeMediaStream("recovered"));
      core.resume();
      await flush();
      expect(core.error).toBeNull();
      expect(core.errorInfo).toBeNull();
    });
  });
});
