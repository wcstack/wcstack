import { describe, it, expect, afterEach, vi } from "vitest";
import { ShareCore } from "../src/core/ShareCore";
import { installShare, removeShare } from "./mocks";

describe("ShareCore", () => {
  afterEach(() => {
    removeShare();
    vi.restoreAllMocks();
  });

  it("EventTarget を継承している", () => {
    const core = new ShareCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  describe("wcBindable プロトコル宣言", () => {
    it("properties が value/loading/error/cancelled/errorInfo を宣言している", () => {
      const names = ShareCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["value", "loading", "error", "cancelled", "errorInfo"]);
    });

    it("errorInfo の event が wcs-share:error-info-changed で getter を持たない（detail が値）", () => {
      const prop = ShareCore.wcBindable.properties.find((p) => p.name === "errorInfo")!;
      expect(prop.event).toBe("wcs-share:error-info-changed");
      expect(prop.getter).toBeUndefined();
    });

    it("value の event が wcs-share:complete で getter が detail.value を返す", () => {
      const prop = ShareCore.wcBindable.properties.find((p) => p.name === "value")!;
      expect(prop.event).toBe("wcs-share:complete");
      const ev = new CustomEvent("wcs-share:complete", { detail: { value: { url: "https://example.com" } } });
      expect(prop.getter!(ev)).toEqual({ url: "https://example.com" });
    });

    it("loading の event が wcs-share:loading-changed", () => {
      const prop = ShareCore.wcBindable.properties.find((p) => p.name === "loading")!;
      expect(prop.event).toBe("wcs-share:loading-changed");
    });

    it("error の event が wcs-share:error", () => {
      const prop = ShareCore.wcBindable.properties.find((p) => p.name === "error")!;
      expect(prop.event).toBe("wcs-share:error");
    });

    it("cancelled の event が wcs-share:cancelled-changed", () => {
      const prop = ShareCore.wcBindable.properties.find((p) => p.name === "cancelled")!;
      expect(prop.event).toBe("wcs-share:cancelled-changed");
    });

    it("commands は share(async) のみを宣言している（abort コマンドは持たない）", () => {
      const commands = ShareCore.wcBindable.commands!;
      expect(commands.map((c) => c.name)).toEqual(["share"]);
      expect(commands.find((c) => c.name === "share")!.async).toBe(true);
    });

    it("protocol/version が固定値", () => {
      expect(ShareCore.wcBindable.protocol).toBe("wc-bindable");
      expect(ShareCore.wcBindable.version).toBe(1);
    });
  });

  describe("初期状態", () => {
    it("value/loading/error/cancelled が既定値", () => {
      const core = new ShareCore();
      expect(core.value).toBeNull();
      expect(core.loading).toBe(false);
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(false);
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new ShareCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() は ready を返し、冪等に再呼び出しできる", async () => {
      const core = new ShareCore();
      await expect(core.observe()).resolves.toBeUndefined();
      await expect(core.observe()).resolves.toBeUndefined();
    });
  });

  describe("share() 成功時", () => {
    it("value に data がエコーバックされ、loading が true→false と遷移する", async () => {
      installShare(() => Promise.resolve());
      const core = new ShareCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-share:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const data = { title: "記事タイトル", url: "https://example.com" };
      const result = await core.share(data);

      expect(result).toEqual(data);
      expect(core.value).toEqual(data);
      expect(core.loading).toBe(false);
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(false);
      expect(loadingEvents).toEqual([true, false]);
    });

    it("wcs-share:complete イベントの detail.value が data と一致する", async () => {
      installShare(() => Promise.resolve());
      const core = new ShareCore();
      const completes: any[] = [];
      core.addEventListener("wcs-share:complete", (e) => completes.push((e as CustomEvent).detail));

      const data = { url: "https://example.com" };
      await core.share(data);

      expect(completes).toEqual([{ value: data }]);
    });

    it("data 省略で呼んでも成功し value は null。complete は成功完了シグナルとして value=null でも発火する（value に同値ガード無し）", async () => {
      installShare(() => Promise.resolve());
      const core = new ShareCore();
      const completes: any[] = [];
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-share:complete", (e) => completes.push((e as CustomEvent).detail));
      core.addEventListener("wcs-share:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const result = await core.share();

      expect(result).toBeNull();
      expect(core.value).toBeNull();
      // value は成功完了シグナルであり同値ガードを持たないため、value=null（初期値と同値）
      // の data-less share でも wcs-share:complete が発火する。loading も通常どおり true→false。
      expect(completes).toEqual([{ value: null }]);
      expect(loadingEvents).toEqual([true, false]);
    });

    it("進行中に重ねて share() を呼ぶと exhaust で2回目は no-op（navigator.share は1回のみ・loading 再発火なし）", async () => {
      // 1呼び出し=1ダイアログ（docs/web-share-tag-design.md §2）を lane の exhaust policy が
      // クライアント側で強制する。進行中の2回目は begin() が null を返し ticket 化されず、
      // navigator.share すら呼ばれない（旧実装はプラットフォームの InvalidStateError 依存）。
      let resolveFirst!: () => void;
      let call = 0;
      installShare(() => new Promise<void>((resolve) => { call += 1; resolveFirst = resolve; }));
      const core = new ShareCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-share:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const p1 = core.share({ url: "https://example.com/1" });
      expect(loadingEvents).toEqual([true]);

      // exhaust: 進行中なので2回目は即 null（navigator.share を呼ばず loading も再発火しない）
      const result2 = await core.share({ url: "https://example.com/2" });
      expect(result2).toBeNull();
      expect(call).toBe(1);
      expect(loadingEvents).toEqual([true]);

      resolveFirst();
      await p1;
      expect(loadingEvents).toEqual([true, false]);
    });

    it("target 指定時はイベントが target にディスパッチされる", async () => {
      installShare(() => Promise.resolve());
      const target = new EventTarget();
      const core = new ShareCore(target);
      const coreEvents: string[] = [];
      const targetEvents: string[] = [];
      core.addEventListener("wcs-share:complete", () => coreEvents.push("complete"));
      target.addEventListener("wcs-share:complete", () => targetEvents.push("complete"));

      await core.share({ url: "https://example.com" });

      expect(coreEvents).toEqual([]);
      expect(targetEvents).toEqual(["complete"]);
    });

    it("同一オブジェクト参照を data として渡した連続する成功 share() でも、成功完了シグナル wcs-share:complete は毎回発火する（value に同値ガード無し、clipboard/broadcast と同方針）", async () => {
      installShare(() => Promise.resolve());
      const core = new ShareCore();
      const completes: any[] = [];
      core.addEventListener("wcs-share:complete", (e) => completes.push((e as CustomEvent).detail));

      const data = { url: "https://example.com" };
      await core.share(data);
      await core.share(data); // same reference as the first call

      // 2回とも成功完了なので complete は2回発火する（value は結果イベントであり
      // idempotent state ではない — clipboard `_setRead` / broadcast `_setMessage` と同方針）。
      expect(completes).toEqual([{ value: data }, { value: data }]);
      expect(core.value).toBe(data);
    });
  });

  describe("AbortError（ユーザーキャンセル）", () => {
    it("cancelled が true になり error は変化しない", async () => {
      installShare(() => Promise.reject(new DOMException("Share canceled", "AbortError")));
      const core = new ShareCore();

      const result = await core.share({ url: "https://example.com" });

      expect(result).toBeNull();
      expect(core.cancelled).toBe(true);
      expect(core.error).toBeNull();
      expect(core.loading).toBe(false);
    });

    it("wcs-share:cancelled-changed が発火し wcs-share:error は発火しない", async () => {
      installShare(() => Promise.reject(new DOMException("Share canceled", "AbortError")));
      const core = new ShareCore();
      const cancelledEvents: boolean[] = [];
      const errorEvents: any[] = [];
      core.addEventListener("wcs-share:cancelled-changed", (e) => cancelledEvents.push((e as CustomEvent).detail));
      core.addEventListener("wcs-share:error", (e) => errorEvents.push((e as CustomEvent).detail));

      await core.share({ url: "https://example.com" });

      expect(cancelledEvents).toEqual([true]);
      expect(errorEvents).toEqual([]);
    });
  });

  describe("AbortError 以外の例外（真の失敗）", () => {
    it("error が設定され cancelled は false のまま", async () => {
      installShare(() => Promise.reject(new DOMException("Permission denied", "NotAllowedError")));
      const core = new ShareCore();

      const result = await core.share({ url: "https://example.com" });

      expect(result).toBeNull();
      expect(core.error).toBeInstanceOf(DOMException);
      expect(core.cancelled).toBe(false);
      expect(core.loading).toBe(false);
    });

    it("name プロパティを持たない一般的な Error でも error に落ちる", async () => {
      installShare(() => Promise.reject(new TypeError("boom")));
      const core = new ShareCore();

      const result = await core.share({ url: "https://example.com" });

      expect(result).toBeNull();
      expect(core.error).toBeInstanceOf(TypeError);
      expect(core.cancelled).toBe(false);
    });

    it("wcs-share:error が発火し detail が core.error と一致する（cancelled-changed 側の対称テスト、line 198-210 参照）", async () => {
      installShare(() => Promise.reject(new DOMException("Permission denied", "NotAllowedError")));
      const core = new ShareCore();
      const errorEvents: any[] = [];
      const cancelledEvents: boolean[] = [];
      core.addEventListener("wcs-share:error", (e) => errorEvents.push((e as CustomEvent).detail));
      core.addEventListener("wcs-share:cancelled-changed", (e) => cancelledEvents.push((e as CustomEvent).detail));

      await core.share({ url: "https://example.com" });

      expect(errorEvents).toEqual([core.error]);
      expect(cancelledEvents).toEqual([]);
    });
  });

  describe("次回 share() でのリセット", () => {
    it("前回 cancelled が今回成功時にリセットされる", async () => {
      const fn = installShare(() => Promise.resolve());
      fn.mockRejectedValueOnce(new DOMException("Share canceled", "AbortError"));
      const core = new ShareCore();

      await core.share({ url: "https://example.com" });
      expect(core.cancelled).toBe(true);

      await core.share({ url: "https://example.com" });
      expect(core.cancelled).toBe(false);
    });

    it("前回 error が今回成功時にリセットされる", async () => {
      const fn = installShare(() => Promise.resolve());
      fn.mockRejectedValueOnce(new DOMException("boom", "NotAllowedError"));
      const core = new ShareCore();

      await core.share({ url: "https://example.com" });
      expect(core.error).not.toBeNull();

      await core.share({ url: "https://example.com" });
      expect(core.error).toBeNull();
    });

    it("前回 error が今回キャンセル時にもリセットされる", async () => {
      const fn = installShare(() => Promise.reject(new DOMException("boom", "NotAllowedError")));
      const core = new ShareCore();
      await core.share({ url: "https://example.com" });
      expect(core.error).not.toBeNull();

      fn.mockRejectedValueOnce(new DOMException("Share canceled", "AbortError"));
      await core.share({ url: "https://example.com" });
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(true);
    });
  });

  describe("unsupported 環境", () => {
    it("navigator.share 不在時は即 error になり loading は true にすらならない", async () => {
      removeShare();
      const core = new ShareCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-share:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const result = await core.share({ url: "https://example.com" });

      expect(result).toBeNull();
      expect(core.error).toEqual({ message: "Web Share API is not supported in this browser." });
      expect(core.loading).toBe(false);
      expect(loadingEvents).toEqual([]);
      // capability-missing taxonomy（既存 error shape は不変・errorInfo は追加）
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "start", recoverable: false,
        capabilityId: "web.share",
        message: "Web Share API is not supported in this browser.",
      });
      expect(core.supported).toBe(false);
      expect(core.platformAssessment.readiness).toBe("idle");
    });

    it("前回 cancelled=true のまま navigator.share が消えて呼ぶと、unsupported の error は立つが cancelled はリセットされず true のまま残る（README 注記のとおり、reset ブロックより前に return するため）", async () => {
      installShare(() => Promise.reject(new DOMException("Share canceled", "AbortError")));
      const core = new ShareCore();
      await core.share({ url: "https://example.com" });
      expect(core.cancelled).toBe(true);

      removeShare();
      const result = await core.share({ url: "https://example.com" });

      expect(result).toBeNull();
      expect(core.error).toEqual({ message: "Web Share API is not supported in this browser." });
      expect(core.cancelled).toBe(true);
    });
  });

  describe("dispose 世代ガード（lane owner generation）", () => {
    it("dispose 後に resolve した stale な share() は状態を書かない", async () => {
      let resolveShare!: () => void;
      installShare(() => new Promise<void>((resolve) => { resolveShare = resolve; }));
      const core = new ShareCore();

      const promise = core.share({ url: "https://example.com" });
      expect(core.loading).toBe(true);

      core.dispose(); // lane owner generation を進める
      resolveShare();

      const result = await promise;
      expect(result).toBeNull();
      // stale なので value は初期値のまま、loading も dispose 前の値のまま
      expect(core.value).toBeNull();
    });

    it("dispose 後に reject（AbortError 以外）した stale な share() は状態を書かない", async () => {
      let rejectShare!: (e: any) => void;
      installShare(() => new Promise<void>((_resolve, reject) => { rejectShare = reject; }));
      const core = new ShareCore();

      const promise = core.share({ url: "https://example.com" });
      core.dispose();
      rejectShare(new TypeError("boom"));

      const result = await promise;
      expect(result).toBeNull();
      expect(core.error).toBeNull();
    });

    it("dispose 後に reject（AbortError）した stale な share() は cancelled も書かない", async () => {
      let rejectShare!: (e: any) => void;
      installShare(() => new Promise<void>((_resolve, reject) => { rejectShare = reject; }));
      const core = new ShareCore();

      const promise = core.share({ url: "https://example.com" });
      core.dispose();
      rejectShare(new DOMException("Share canceled", "AbortError"));

      const result = await promise;
      expect(result).toBeNull();
      expect(core.cancelled).toBe(false);
    });

    it("dispose で loading=true が残った後、新しい share() の loading=true は同値ガードで再発火しない", async () => {
      let rejectFirst!: (e: any) => void;
      let first = true;
      installShare(() => {
        if (first) { first = false; return new Promise<void>((_r, reject) => { rejectFirst = reject; }); }
        return Promise.resolve();
      });
      const core = new ShareCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-share:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const p1 = core.share({ url: "https://example.com/1" });
      expect(loadingEvents).toEqual([true]);
      core.dispose();                    // loading=true のまま残る（stale は状態を書かない）
      rejectFirst(new TypeError("x"));
      await p1;
      expect(core.loading).toBe(true);

      // 新しい share(): _setLoading(true) は現在値と同値なので再発火せず、成功時の false のみ。
      const result = await core.share({ url: "https://example.com/2" });
      expect(result).toEqual({ url: "https://example.com/2" });
      expect(loadingEvents).toEqual([true, false]);
    });
  });

  describe("並行 share() 呼び出し（exhaust: 2回目は no-op）", () => {
    it("1回目 pending 中の2回目は navigator.share を呼ばず即 null（InvalidStateError を招かない）で、1回目の成功は汚染されない", async () => {
      let resolveFirst!: () => void;
      let call = 0;
      installShare(() => {
        call += 1;
        return new Promise<void>((resolve) => { resolveFirst = resolve; });
      });
      const core = new ShareCore();

      const data1 = { url: "https://example.com/1" };
      const data2 = { url: "https://example.com/2" };
      const p1 = core.share(data1);

      // exhaust: 進行中の2回目は ticket 化されず navigator.share すら呼ばれない。旧実装は
      // 2回目が InvalidStateError で reject → setError で1回目の結果を汚染していた（バグ）。
      const result2 = await core.share(data2);
      expect(result2).toBeNull();
      expect(call).toBe(1);
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(false);

      resolveFirst();
      const result1 = await p1;

      // 1回目の成功はクリーンに反映される（2回目に破棄も汚染もされない）。
      expect(result1).toEqual(data1);
      expect(core.value).toEqual(data1);
      expect(core.error).toBeNull();
    });
  });

  describe("errorInfo（bindable 出力・wcs-share:error-info-changed）", () => {
    it("真の失敗で errorInfo=share-failed が detail 付きで発火し、次の share 開始時に null で発火する", async () => {
      let call = 0;
      installShare(() => {
        call += 1;
        return call === 1 ? Promise.reject(new TypeError("boom")) : Promise.resolve();
      });
      const core = new ShareCore();
      const details: unknown[] = [];
      core.addEventListener("wcs-share:error-info-changed", (e) => details.push((e as CustomEvent).detail));

      await core.share({ url: "https://example.com" }); // 失敗 → null→object で1回発火
      expect(details).toHaveLength(1);
      expect((details[0] as { code: string }).code).toBe("share-failed");
      expect(core.errorInfo?.recoverable).toBe(true);

      await core.share({ url: "https://example.com" }); // 成功: 開始時に object→null クリアで1回発火
      expect(details).toHaveLength(2);
      expect(details[1]).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("エラーなしの成功では error-info-changed を発火しない（同値ガード）", async () => {
      installShare(() => Promise.resolve());
      const core = new ShareCore();
      const details: unknown[] = [];
      core.addEventListener("wcs-share:error-info-changed", (e) => details.push((e as CustomEvent).detail));

      await core.share({ url: "https://example.com" });
      expect(details).toHaveLength(0);
      expect(core.errorInfo).toBeNull();
    });

    it("ユーザーキャンセル（AbortError）は errorInfo を立てない", async () => {
      installShare(() => Promise.reject(new DOMException("Share canceled", "AbortError")));
      const core = new ShareCore();
      await core.share({ url: "https://example.com" });
      expect(core.cancelled).toBe(true);
      expect(core.errorInfo).toBeNull();
    });

    it("イベントは bubbles する", async () => {
      installShare(() => Promise.reject(new TypeError("boom")));
      const core = new ShareCore();
      let bubbles = false;
      core.addEventListener("wcs-share:error-info-changed", (e) => { bubbles = e.bubbles; });
      await core.share({ url: "https://example.com" });
      expect(bubbles).toBe(true);
    });

    it("navigator.share があれば supported=true・readiness=ready", () => {
      installShare(() => Promise.resolve());
      const core = new ShareCore();
      expect(core.supported).toBe(true);
      expect(core.platformAssessment.readiness).toBe("ready");
      expect(core.platformAssessment.availability.get("web.share")).toBe("available");
    });

    it("message を持たない失敗は errorInfo.message を既定文言にフォールバックする", async () => {
      installShare(() => Promise.reject({ name: "WeirdError" })); // message なし・非 AbortError
      const core = new ShareCore();
      await core.share({ url: "https://example.com" });
      expect(core.errorInfo).toEqual({ code: "share-failed", phase: "execute", recoverable: true, message: "Share failed." });
      expect(core.error).toEqual({ name: "WeirdError" });
    });

    it("falsy な rejection(null)でも error は非 null envelope になり errorInfo と同期する", async () => {
      installShare(() => Promise.reject(null)); // 病的な share: null を reject
      const core = new ShareCore();
      await core.share({ url: "https://example.com" });
      expect(core.error).toEqual({ message: "Share failed." }); // 同値ガードに潰されず非 null
      expect(core.errorInfo?.code).toBe("share-failed");
    });
  });

  describe("never-throw", () => {
    it("share() はどの経路でも例外を投げず常に resolve する", async () => {
      installShare(() => Promise.reject(new Error("network down")));
      const core = new ShareCore();
      await expect(core.share({ url: "https://example.com" })).resolves.toBeNull();
    });

    it("data に不正な値（null）を渡しても投げない", async () => {
      installShare(() => Promise.resolve());
      const core = new ShareCore();
      await expect(core.share(null as any)).resolves.toBeNull();
    });
  });

  describe("dispose()", () => {
    it("一度も share していない dispose は安全な no-op", () => {
      const core = new ShareCore();
      expect(() => core.dispose()).not.toThrow();
    });
  });

  describe("イベントの bubbles 契約", () => {
    it("全4イベントが bubbles: true で発火する（祖先要素での委譲リスニング契約、eyedropper 姉妹の同型テストに倣う）", async () => {
      // state の twowayHandler は要素直付けリスナーのため bubbles に依存しないが、
      // Shell を祖先要素で委譲リスニングする利用者コードにとっては 4 つの
      // _setXxx すべてが bubbles: true で dispatch することが契約になる。
      // ここで4イベントまとめてピン留めする。
      const fn = installShare(() => Promise.reject(new DOMException("Permission denied", "NotAllowedError")));
      const core = new ShareCore();
      const bubblesByEvent: Record<string, boolean[]> = {
        "wcs-share:loading-changed": [],
        "wcs-share:complete": [],
        "wcs-share:error": [],
        "wcs-share:cancelled-changed": [],
      };
      for (const name of Object.keys(bubblesByEvent)) {
        core.addEventListener(name, (e) => bubblesByEvent[name].push((e as Event).bubbles));
      }

      // error（NotAllowedError）→ 成功（complete）→ AbortError（cancelled）の
      // 順に3回 share() し、4イベントすべてを少なくとも1回ずつ発火させる。
      await core.share({ url: "https://example.com/1" });

      fn.mockResolvedValueOnce(undefined);
      await core.share({ url: "https://example.com/2" });

      fn.mockRejectedValueOnce(new DOMException("Share canceled", "AbortError"));
      await core.share({ url: "https://example.com/3" });

      for (const [name, flags] of Object.entries(bubblesByEvent)) {
        expect(flags.length, `${name} が発火していること`).toBeGreaterThan(0);
        expect(flags.every((b) => b === true), `${name} の bubbles`).toBe(true);
      }
    });
  });
});
