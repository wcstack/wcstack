import { describe, it, expect, afterEach, vi } from "vitest";
import { EyedropperCore } from "../src/core/EyedropperCore";
import { installEyeDropper, removeEyeDropper } from "./mocks";

describe("EyedropperCore", () => {
  afterEach(() => {
    removeEyeDropper();
    vi.restoreAllMocks();
  });

  it("EventTarget を継承している", () => {
    const core = new EyedropperCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  describe("wcBindable プロトコル宣言", () => {
    it("properties が value/loading/error/cancelled/errorInfo を宣言している", () => {
      const names = EyedropperCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["value", "loading", "error", "cancelled", "errorInfo"]);
    });

    it("errorInfo の event が wcs-eyedropper:error-info-changed で getter を持たない（detail が値）", () => {
      const prop = EyedropperCore.wcBindable.properties.find((p) => p.name === "errorInfo")!;
      expect(prop.event).toBe("wcs-eyedropper:error-info-changed");
      expect(prop.getter).toBeUndefined();
    });

    it("value の event が wcs-eyedropper:complete で getter が detail.value を返す", () => {
      const prop = EyedropperCore.wcBindable.properties.find((p) => p.name === "value")!;
      expect(prop.event).toBe("wcs-eyedropper:complete");
      const ev = new CustomEvent("wcs-eyedropper:complete", { detail: { value: { sRGBHex: "#aabbcc" } } });
      expect(prop.getter!(ev)).toEqual({ sRGBHex: "#aabbcc" });
    });

    it("loading の event が wcs-eyedropper:loading-changed", () => {
      const prop = EyedropperCore.wcBindable.properties.find((p) => p.name === "loading")!;
      expect(prop.event).toBe("wcs-eyedropper:loading-changed");
    });

    it("error の event が wcs-eyedropper:error", () => {
      const prop = EyedropperCore.wcBindable.properties.find((p) => p.name === "error")!;
      expect(prop.event).toBe("wcs-eyedropper:error");
    });

    it("cancelled の event が wcs-eyedropper:cancelled-changed", () => {
      const prop = EyedropperCore.wcBindable.properties.find((p) => p.name === "cancelled")!;
      expect(prop.event).toBe("wcs-eyedropper:cancelled-changed");
    });

    it("commands は open(async)/abort を宣言している", () => {
      const commands = EyedropperCore.wcBindable.commands!;
      expect(commands.map((c) => c.name)).toEqual(["open", "abort"]);
      expect(commands.find((c) => c.name === "open")!.async).toBe(true);
      expect(commands.find((c) => c.name === "abort")!.async).toBeUndefined();
    });

    it("protocol/version が固定値", () => {
      expect(EyedropperCore.wcBindable.protocol).toBe("wc-bindable");
      expect(EyedropperCore.wcBindable.version).toBe(1);
    });
  });

  describe("初期状態", () => {
    it("value/loading/error/cancelled が既定値", () => {
      const core = new EyedropperCore();
      expect(core.value).toBeNull();
      expect(core.loading).toBe(false);
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(false);
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new EyedropperCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() は ready を返し、冪等に再呼び出しできる", async () => {
      const core = new EyedropperCore();
      await expect(core.observe()).resolves.toBeUndefined();
      await expect(core.observe()).resolves.toBeUndefined();
    });
  });

  describe("open() 成功時", () => {
    it("{sRGBHex} がそのまま value に渡され、loading が true→false と遷移する", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-eyedropper:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const promise = core.open();
      expect(pendingOpens).toHaveLength(1);
      pendingOpens[0].resolve({ sRGBHex: "#aabbcc" });
      const result = await promise;

      expect(result).toEqual({ sRGBHex: "#aabbcc" });
      expect(core.value).toEqual({ sRGBHex: "#aabbcc" });
      expect(core.loading).toBe(false);
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(false);
      expect(loadingEvents).toEqual([true, false]);
    });

    it("wcs-eyedropper:complete イベントの detail.value が結果と一致する", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const completes: any[] = [];
      core.addEventListener("wcs-eyedropper:complete", (e) => completes.push((e as CustomEvent).detail));

      const promise = core.open();
      pendingOpens[0].resolve({ sRGBHex: "#112233" });
      await promise;

      expect(completes).toEqual([{ value: { sRGBHex: "#112233" } }]);
    });

    it("open() は引数を取らない", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      expect(core.open.length).toBe(0);
      const promise = core.open();
      pendingOpens[0].resolve({ sRGBHex: "#ffffff" });
      await promise;
    });

    it("target 指定時はイベントが target にディスパッチされる", async () => {
      const { pendingOpens } = installEyeDropper();
      const target = new EventTarget();
      const core = new EyedropperCore(target);
      const coreEvents: string[] = [];
      const targetEvents: string[] = [];
      core.addEventListener("wcs-eyedropper:complete", () => coreEvents.push("complete"));
      target.addEventListener("wcs-eyedropper:complete", () => targetEvents.push("complete"));

      const promise = core.open();
      pendingOpens[0].resolve({ sRGBHex: "#000000" });
      await promise;

      expect(coreEvents).toEqual([]);
      expect(targetEvents).toEqual(["complete"]);
    });
  });

  describe("AbortError（ユーザーの Esc キャンセル）", () => {
    it("cancelled が true になり error は変化しない", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const promise = core.open();
      pendingOpens[0].reject(new DOMException("The user aborted a request.", "AbortError"));
      const result = await promise;

      expect(result).toBeNull();
      expect(core.cancelled).toBe(true);
      expect(core.error).toBeNull();
      expect(core.loading).toBe(false);
    });

    it("wcs-eyedropper:cancelled-changed が発火し wcs-eyedropper:error は発火しない", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const cancelledEvents: boolean[] = [];
      const errorEvents: any[] = [];
      core.addEventListener("wcs-eyedropper:cancelled-changed", (e) => cancelledEvents.push((e as CustomEvent).detail));
      core.addEventListener("wcs-eyedropper:error", (e) => errorEvents.push((e as CustomEvent).detail));

      const promise = core.open();
      pendingOpens[0].reject(new DOMException("The user aborted a request.", "AbortError"));
      await promise;

      expect(cancelledEvents).toEqual([true]);
      expect(errorEvents).toEqual([]);
    });
  });

  describe("abort() コマンド（呼び出し元からの中断）", () => {
    it("進行中の open() を中断し、cancelled が true になる", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const promise = core.open();
      expect(core.loading).toBe(true);

      core.abort();
      const result = await promise;

      expect(result).toBeNull();
      expect(core.cancelled).toBe(true);
      expect(core.error).toBeNull();
      expect(core.loading).toBe(false);
      // abort() 経由でも fake 側の AbortSignal が abort イベントを受けて同じ
      // AbortError で reject する経路を通っていることを確認する。
      expect(pendingOpens[0].signal?.aborted).toBe(true);
    });

    it("open() 実行前に呼んでも何も起きない（no-op）", () => {
      installEyeDropper();
      const core = new EyedropperCore();
      expect(() => core.abort()).not.toThrow();
      expect(core.loading).toBe(false);
      expect(core.cancelled).toBe(false);
    });
  });

  describe("abort() → open() の連打（AbortController の混線防止）", () => {
    it("新しい open() の AbortController が古いものと混線しない（FetchCore と同型の identity チェック）", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const p1 = core.open();
      expect(pendingOpens).toHaveLength(1);
      const firstSignal = pendingOpens[0].signal;

      // 2回目の open() は内部で abort() を呼んでから新しい AbortController を発行する。
      const p2 = core.open();
      expect(pendingOpens).toHaveLength(2);
      const secondSignal = pendingOpens[1].signal;

      expect(firstSignal).not.toBe(secondSignal);
      expect(firstSignal?.aborted).toBe(true); // 1回目は2回目の開始時に中断されている

      // 1回目の in-flight Promise は abort() 済みなので AbortError で reject するが、
      // _gen が2回目の open() 開始時に進んでいるため stale 扱いとなり、state は書かない
      // （2回目が既に _setCancelled(false) でリセット済みのため cancelled は false のまま）。
      const result1 = await p1;
      expect(result1).toBeNull();
      expect(core.cancelled).toBe(false);

      // 2回目を成功させると、1回目の finally が2回目の AbortController を
      // null 化しない（identity チェック）ことを、後続の abort() が2回目の
      // signal に届くかどうかで確認する。
      core.abort();
      expect(secondSignal?.aborted).toBe(true);
      const result2 = await p2;
      expect(result2).toBeNull();
    });

    it("1回目が abort 完了後、2回目が成功すると2回目の結果が state に反映される", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const p1 = core.open();
      const p2 = core.open(); // 内部 abort() で1回目を中断
      await p1;

      pendingOpens[1].resolve({ sRGBHex: "#654321" });
      const result2 = await p2;

      expect(result2).toEqual({ sRGBHex: "#654321" });
      expect(core.value).toEqual({ sRGBHex: "#654321" });
      expect(core.cancelled).toBe(false);
    });
  });

  describe("AbortError 以外の例外（真の失敗）", () => {
    it("error が設定され cancelled は false のまま", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const promise = core.open();
      pendingOpens[0].reject(new DOMException("Permission denied", "NotAllowedError"));
      const result = await promise;

      expect(result).toBeNull();
      expect(core.error).toBeInstanceOf(DOMException);
      expect(core.cancelled).toBe(false);
      expect(core.loading).toBe(false);
    });

    it("大域排他の InvalidStateError（別インスタンスのピッカーが開いている）も error に落ちる", async () => {
      // WICG 仕様の InvalidStateError は「別の eye dropper が既に開いている」
      // ときの大域排他。同一 Core 内では open() 冒頭の abort() による直列化で
      // 発生しないが、複数の Core（複数の <wcs-eyedropper> や別タブ）が並行した
      // 実環境では2本目の open() がこれで reject される
      // （docs/eyedropper-tag-design.md §2）。AbortError ではないため
      // cancelled ではなく error に着地する。
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const promise = core.open();
      pendingOpens[0].reject(new DOMException("Another eye dropper is already open.", "InvalidStateError"));
      const result = await promise;

      expect(result).toBeNull();
      expect(core.error).toBeInstanceOf(DOMException);
      expect(core.error.name).toBe("InvalidStateError");
      expect(core.cancelled).toBe(false);
    });

    it("name プロパティを持たない一般的な Error でも error に落ちる", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const promise = core.open();
      pendingOpens[0].reject(new TypeError("boom"));
      const result = await promise;

      expect(result).toBeNull();
      expect(core.error).toBeInstanceOf(TypeError);
      expect(core.cancelled).toBe(false);
    });
  });

  describe("次回 open() でのリセット", () => {
    it("前回 cancelled が今回成功時にリセットされる（cancelled-changed が false で発火する）", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const cancelledEvents: boolean[] = [];
      core.addEventListener("wcs-eyedropper:cancelled-changed", (e) => cancelledEvents.push((e as CustomEvent).detail));

      const p1 = core.open();
      pendingOpens[0].reject(new DOMException("The user aborted a request.", "AbortError"));
      await p1;
      expect(core.cancelled).toBe(true);

      const p2 = core.open();
      pendingOpens[1].resolve({ sRGBHex: "#000000" });
      await p2;
      expect(core.cancelled).toBe(false);
      // リセットはプロパティ値だけでなくイベントとしても観測できること。
      // state の twowayHandler はイベント経由でのみ値を受け取るため、
      // _setCancelled(false) の dispatch が silent 化する退行をここで検出する。
      expect(cancelledEvents).toEqual([true, false]);
    });

    it("前回 error が今回成功時にリセットされる（error イベントが null で発火する）", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const errorEvents: any[] = [];
      core.addEventListener("wcs-eyedropper:error", (e) => errorEvents.push((e as CustomEvent).detail));

      const err = new DOMException("boom", "NotAllowedError");
      const p1 = core.open();
      pendingOpens[0].reject(err);
      await p1;
      expect(core.error).not.toBeNull();

      const p2 = core.open();
      pendingOpens[1].resolve({ sRGBHex: "#000000" });
      await p2;
      expect(core.error).toBeNull();
      // _setError(null) のリセットもイベント経由で観測できること（前掲と同じ理由）。
      expect(errorEvents).toEqual([err, null]);
    });

    it("前回 error が今回キャンセル時にもリセットされる（error: null と cancelled: true が発火する）", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const errorEvents: any[] = [];
      const cancelledEvents: boolean[] = [];
      core.addEventListener("wcs-eyedropper:error", (e) => errorEvents.push((e as CustomEvent).detail));
      core.addEventListener("wcs-eyedropper:cancelled-changed", (e) => cancelledEvents.push((e as CustomEvent).detail));

      const err = new DOMException("boom", "NotAllowedError");
      const p1 = core.open();
      pendingOpens[0].reject(err);
      await p1;
      expect(core.error).not.toBeNull();

      const p2 = core.open();
      pendingOpens[1].reject(new DOMException("The user aborted a request.", "AbortError"));
      await p2;
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(true);
      // リセット（error: err→null）と今回の結果（cancelled: →true）の両方が
      // イベントとして発火していること。2回目 open() 冒頭の _setCancelled(false) は
      // 同値（false のまま）なので発火しない。
      expect(errorEvents).toEqual([err, null]);
      expect(cancelledEvents).toEqual([true]);
    });
  });

  describe("unsupported 環境", () => {
    it("typeof EyeDropper === 'undefined' 時は即 error になり loading は true にすらならない", async () => {
      removeEyeDropper();
      const core = new EyedropperCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-eyedropper:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const result = await core.open();

      expect(result).toBeNull();
      expect(core.error).toEqual({ message: "EyeDropper API is not supported in this browser." });
      expect(core.loading).toBe(false);
      expect(loadingEvents).toEqual([]);
      // capability-missing taxonomy（既存 error shape は不変・errorInfo は追加）
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "start", recoverable: false,
        capabilityId: "web.eyedropper",
        message: "EyeDropper API is not supported in this browser.",
      });
      expect(core.supported).toBe(false);
      expect(core.platformAssessment.readiness).toBe("idle");
    });

    it("EyeDropper が関数でない truthy 値でも unsupported として即 error になる", async () => {
      // 対応判定は typeof EyeDropper === "function"（README / docs
      // eyedropper-tag-design.md §4・§7 の規範）。truthy かどうかの判定に
      // 退行すると new が試みられ、try 内の TypeError として error の内容が
      // 変わってしまう — 「関数であること」側の半分をここでピン留めする。
      (globalThis as any).EyeDropper = {};
      const core = new EyedropperCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-eyedropper:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const result = await core.open();

      expect(result).toBeNull();
      expect(core.error).toEqual({ message: "EyeDropper API is not supported in this browser." });
      expect(core.loading).toBe(false);
      expect(loadingEvents).toEqual([]);

      delete (globalThis as any).EyeDropper;
    });
  });

  describe("errorInfo（bindable 出力・wcs-eyedropper:error-info-changed）", () => {
    it("真の失敗で errorInfo=pick-failed が detail 付きで発火し、次の open 開始時に null で発火する", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const details: unknown[] = [];
      core.addEventListener("wcs-eyedropper:error-info-changed", (e) => details.push((e as CustomEvent).detail));

      const p1 = core.open();
      pendingOpens[0].reject(new DOMException("Permission denied", "NotAllowedError"));
      await p1;
      expect(details).toHaveLength(1);
      expect((details[0] as { code: string }).code).toBe("pick-failed");
      expect(core.errorInfo?.recoverable).toBe(true);

      const p2 = core.open();
      pendingOpens[1].resolve({ sRGBHex: "#123456" });
      await p2;
      expect(details).toHaveLength(2);
      expect(details[1]).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("成功のみでは error-info-changed を発火しない（同値ガード）", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const details: unknown[] = [];
      core.addEventListener("wcs-eyedropper:error-info-changed", (e) => details.push((e as CustomEvent).detail));
      const p = core.open();
      pendingOpens[0].resolve({ sRGBHex: "#abcdef" });
      await p;
      expect(details).toHaveLength(0);
      expect(core.errorInfo).toBeNull();
    });

    it("キャンセル（AbortError）は errorInfo を立てない", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const p = core.open();
      pendingOpens[0].reject(new DOMException("aborted", "AbortError"));
      await p;
      expect(core.cancelled).toBe(true);
      expect(core.errorInfo).toBeNull();
    });

    it("イベントは bubbles する", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      let bubbles = false;
      core.addEventListener("wcs-eyedropper:error-info-changed", (e) => { bubbles = e.bubbles; });
      const p = core.open();
      pendingOpens[0].reject(new TypeError("boom"));
      await p;
      expect(bubbles).toBe(true);
    });

    it("EyeDropper があれば supported=true・readiness=ready", () => {
      installEyeDropper();
      const core = new EyedropperCore();
      expect(core.supported).toBe(true);
      expect(core.platformAssessment.readiness).toBe("ready");
      expect(core.platformAssessment.availability.get("web.eyedropper")).toBe("available");
    });

    it("message を持たない失敗は errorInfo.message を既定文言にフォールバックする", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const p = core.open();
      pendingOpens[0].reject({ name: "WeirdError" });
      await p;
      expect(core.errorInfo).toEqual({ code: "pick-failed", phase: "execute", recoverable: true, message: "Color pick failed." });
      expect(core.error).toEqual({ name: "WeirdError" });
    });

    it("falsy な rejection(null)でも error は非 null envelope になり errorInfo と同期する", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const p = core.open();
      pendingOpens[0].reject(null);
      await p;
      expect(core.error).toEqual({ message: "Color pick failed." });
      expect(core.errorInfo?.code).toBe("pick-failed");
    });
  });

  describe("commit guard（latest の同期 supersede）", () => {
    it("setter が同期発火した event で同 lane を supersede すると残りの commit を止める（guard 後検査）", async () => {
      // §5.1: _setValue の complete event を listener が受けて同期的に open() を呼ぶと、
      // op1 は superseded となり、op1 の後続 _setLoading(false) は CommitGuard で止まる
      // （既発生の副作用は巻き戻さない）。fetch の同型テストの eyedropper 版。
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-eyedropper:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));
      let superseded = false;
      core.addEventListener("wcs-eyedropper:complete", () => {
        if (!superseded) {
          superseded = true;
          core.open(); // op1 の setValue 途中で op2 が supersede
        }
      });

      const p1 = core.open();
      pendingOpens[0].resolve({ sRGBHex: "#111111" });
      await p1;
      pendingOpens[1].resolve({ sRGBHex: "#222222" });
      await new Promise((r) => setTimeout(r, 0));

      // op1 の setLoading(false) は guard で抑止され、loading は true→false（op2 の完了のみ）。
      // 抑止されなければ余分な false/true イベントが挟まる。
      expect(loadingEvents).toEqual([true, false]);
      expect(core.loading).toBe(false);
      expect(core.value).toEqual({ sRGBHex: "#222222" });
    });
  });

  describe("dispose 世代ガード（lane owner generation）", () => {
    it("dispose 後に resolve した stale な open() は状態を書かない", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const promise = core.open();
      expect(core.loading).toBe(true);

      core.dispose(); // _gen を進める（内部で abort() も呼ぶ）
      pendingOpens[0].resolve({ sRGBHex: "#aabbcc" });

      const result = await promise;
      expect(result).toBeNull();
      // stale なので value は初期値のまま
      expect(core.value).toBeNull();
    });

    it("成功(resolve)パスの直後に _gen が進んでいた場合は状態を書かない（resolve 経路の stale 判定）", async () => {
      // installEyeDropper() の fake は abort シグナルで即座に reject してしまうため、
      // 「resolve 自体は成功するが、await の再開時には既に _gen が進んでいる」という
      // resolve 経路の stale 分岐（open() 内、await 直後の `if (gen !== this._gen)`）を
      // 再現するには、abort に依存しない素朴な fake を直接使う。
      class SlowEyeDropper {
        static resolvers: Array<(r: { sRGBHex: string }) => void> = [];
        open(): Promise<{ sRGBHex: string }> {
          return new Promise((resolve) => {
            SlowEyeDropper.resolvers.push(resolve);
          });
        }
      }
      (globalThis as any).EyeDropper = SlowEyeDropper;

      const core = new EyedropperCore();
      const promise = core.open();
      expect(core.loading).toBe(true);

      // dispose() は abort() 経由で reject させてしまうので使わず、_gen だけを直接
      // 進めたいが、公開APIには observe()/dispose()/open()/abort() しかない。
      // dispose() は abort() を呼ぶが、この fake の open() は signal を購読しない
      // （abort() の効果を受けない）ため、abort() 済みでも Promise は resolve 可能な
      // ままである。これにより「abort 済みだが reject ではなく resolve で解決する」
      // という resolve 経路の stale 判定を再現できる。
      core.dispose(); // _gen を進める（この fake は signal 無視のため reject されない）
      SlowEyeDropper.resolvers[0]({ sRGBHex: "#aabbcc" });

      const result = await promise;
      expect(result).toBeNull();
      expect(core.value).toBeNull();

      delete (globalThis as any).EyeDropper;
    });

    it("dispose 後に reject（AbortError 以外）した stale な open() は状態を書かない", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const promise = core.open();
      core.dispose();
      pendingOpens[0].reject(new TypeError("boom"));

      const result = await promise;
      expect(result).toBeNull();
      expect(core.error).toBeNull();
    });

    it("dispose 後に reject（AbortError）した stale な open() は cancelled も書かない", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const promise = core.open();
      core.dispose();
      // dispose() 内の abort() で signal 自体が abort 済みなので、ここでの
      // reject は既に発火済みの可能性があるが、念のため直接 reject もしておく。
      pendingOpens[0].reject(new DOMException("The user aborted a request.", "AbortError"));

      const result = await promise;
      expect(result).toBeNull();
      expect(core.cancelled).toBe(false);
    });
  });

  describe("never-throw", () => {
    it("open() はどの経路でも例外を投げず常に resolve する", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const promise = core.open();
      pendingOpens[0].reject(new Error("platform crash"));
      await expect(promise).resolves.toBeNull();
    });

    it("name を参照できない null で reject されても throw せず resolve する（e?.name の防衛線）", async () => {
      // 実プラットフォームの reject は常に name を持つ DOMException 等だが、
      // never-throw 契約は「どんな値で reject されても open() 自体は throw
      // しない」ことまで含む。catch 節の e?.name が e.name に退行すると、
      // null からの name 参照で catch 節自体が throw し open() が reject する
      // — その optional chaining の防衛線をここでピン留めする。
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const promise = core.open();
      pendingOpens[0].reject(null);
      await expect(promise).resolves.toBeNull();
      // null は AbortError ではないため cancelled 側には落ちない。
      expect(core.cancelled).toBe(false);
      expect(core.loading).toBe(false);
    });

    it("abort() はどの状態から呼んでも例外を投げない", () => {
      installEyeDropper();
      const core = new EyedropperCore();
      expect(() => core.abort()).not.toThrow();
      core.open();
      expect(() => core.abort()).not.toThrow();
      expect(() => core.abort()).not.toThrow();
    });
  });

  describe("dispose()", () => {
    it("一度も open していない dispose は安全な no-op", () => {
      const core = new EyedropperCore();
      expect(() => core.dispose()).not.toThrow();
    });

    it("進行中の open() を abort する（AbortSignal 経由でピッカー自体を閉じる契約）", async () => {
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();

      const promise = core.open();
      expect(pendingOpens[0].signal?.aborted).toBe(false);

      core.dispose();

      // dispose() は _gen を進めて stale 化するだけでなく abort() も呼び、
      // signal abort でプラットフォームのピッカー自体を閉じる
      // （EyedropperCore.dispose の契約。_gen ガードのテストとは独立に、
      // abort() の呼び出しが実際に signal へ届いていることを直接確認する）。
      expect(pendingOpens[0].signal?.aborted).toBe(true);
      await expect(promise).resolves.toBeNull();
    });
  });

  describe("同値ガード", () => {
    it("進行中に重ねて open() を呼んでも2回目の loading=true は同値ガードで再発火しない", async () => {
      // supersede 経路（open() 進行中の再 open()）。2回目の open() は冒頭の
      // abort() で1回目を中断してから始まるが、loading は true のままなので、
      // 2回目の _setLoading(true) は同値ガードに当たり再発火しない
      // （ガイドライン §3.3 MUST。share の同型テストと対をなす）。
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-eyedropper:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const p1 = core.open();
      expect(loadingEvents).toEqual([true]);
      const p2 = core.open(); // 内部 abort() で1回目を中断してから開始する
      // 2回目の _setLoading(true) は同値なので追加のイベントは発火しない
      expect(loadingEvents).toEqual([true]);

      await p1; // 1回目は stale（_gen 不一致）なので loading には触れない
      pendingOpens[1].resolve({ sRGBHex: "#0f0f0f" });
      await p2;

      expect(loadingEvents).toEqual([true, false]);
    });

    it("同一参照の value が連続で解決しても wcs-eyedropper:complete は再発火しない（_setValue の同値ガード）", async () => {
      const sameResult = { sRGBHex: "#aabbcc" };
      class SameValueEyeDropper {
        open(): Promise<{ sRGBHex: string }> {
          return Promise.resolve(sameResult);
        }
      }
      (globalThis as any).EyeDropper = SameValueEyeDropper;

      const core = new EyedropperCore();
      const completes: any[] = [];
      core.addEventListener("wcs-eyedropper:complete", (e) => completes.push((e as CustomEvent).detail));

      await core.open();
      expect(completes).toHaveLength(1);
      expect(core.value).toBe(sameResult);

      // 2回目も同じ参照のオブジェクトで解決する。_setValue の `===` 比較により
      // 同値と判定され、2回目の wcs-eyedropper:complete は発火しない。
      await core.open();
      expect(completes).toHaveLength(1);

      delete (globalThis as any).EyeDropper;
    });
  });

  describe("イベントの bubbles 契約", () => {
    it("全4イベントが bubbles: true で発火する（祖先要素での委譲リスニング契約）", async () => {
      // state の twowayHandler は要素直付けリスナーのため bubbles に依存しないが、
      // Shell を祖先要素で委譲リスニングする利用者コードにとっては 4 つの
      // _setXxx すべてが bubbles: true で dispatch することが契約になる。
      // ここで4イベントまとめてピン留めする。
      const { pendingOpens } = installEyeDropper();
      const core = new EyedropperCore();
      const bubblesByEvent: Record<string, boolean[]> = {
        "wcs-eyedropper:loading-changed": [],
        "wcs-eyedropper:complete": [],
        "wcs-eyedropper:error": [],
        "wcs-eyedropper:cancelled-changed": [],
      };
      for (const name of Object.keys(bubblesByEvent)) {
        core.addEventListener(name, (e) => bubblesByEvent[name].push(e.bubbles));
      }

      // error → 成功（error リセット + complete）→ AbortError（cancelled）の
      // 順に3回 open() し、4イベントすべてを少なくとも1回ずつ発火させる。
      const p1 = core.open();
      pendingOpens[0].reject(new DOMException("boom", "NotAllowedError"));
      await p1;

      const p2 = core.open();
      pendingOpens[1].resolve({ sRGBHex: "#aabbcc" });
      await p2;

      const p3 = core.open();
      pendingOpens[2].reject(new DOMException("The user aborted a request.", "AbortError"));
      await p3;

      for (const [name, flags] of Object.entries(bubblesByEvent)) {
        expect(flags.length, `${name} が発火していること`).toBeGreaterThan(0);
        expect(flags.every((b) => b === true), `${name} の bubbles`).toBe(true);
      }
    });
  });
});
