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
    it("properties が value/loading/error/cancelled を宣言している", () => {
      const names = ShareCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["value", "loading", "error", "cancelled"]);
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

    it("進行中に重ねて share() を呼んでも2回目の loading=true は同値ガードで再発火しない", async () => {
      // 1呼び出し=1ダイアログが前提だが（docs/web-share-tag-design.md §2）、Core 自体は
      // 呼び出し回数を制限しない。既に loading=true の最中に2回目を呼ぶと、2回目の
      // _setLoading(true) は同値ガードに当たり再発火しないことを確認する（§3.3 MUST）。
      let resolveFirst!: () => void;
      let resolveSecond!: () => void;
      let call = 0;
      installShare(() => new Promise<void>((resolve) => {
        call += 1;
        if (call === 1) resolveFirst = resolve;
        else resolveSecond = resolve;
      }));
      const core = new ShareCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-share:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const p1 = core.share({ url: "https://example.com/1" });
      expect(loadingEvents).toEqual([true]);
      const p2 = core.share({ url: "https://example.com/2" });
      // 2回目の _setLoading(true) は同値なので追加のイベントは発火しない
      expect(loadingEvents).toEqual([true]);

      resolveFirst();
      await p1;
      resolveSecond();
      await p2;

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

  describe("_gen 世代ガード", () => {
    it("dispose 後に resolve した stale な share() は状態を書かない", async () => {
      let resolveShare!: () => void;
      installShare(() => new Promise<void>((resolve) => { resolveShare = resolve; }));
      const core = new ShareCore();

      const promise = core.share({ url: "https://example.com" });
      expect(core.loading).toBe(true);

      core.dispose(); // _gen を進める
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
  });

  describe("並行 share() 呼び出し（supersession は行わない）", () => {
    it("1回目 pending 中に2回目が InvalidStateError で失敗しても、1回目の後続成功は破棄されない（§2: fetch と異なり新規呼び出しは旧呼び出しを追い越さない）", async () => {
      let resolveFirst!: () => void;
      let call = 0;
      installShare(() => {
        call += 1;
        if (call === 1) {
          return new Promise<void>((resolve) => { resolveFirst = resolve; });
        }
        return Promise.reject(new DOMException("Only one share can be active at a time", "InvalidStateError"));
      });
      const core = new ShareCore();

      const data1 = { url: "https://example.com/1" };
      const data2 = { url: "https://example.com/2" };
      const p1 = core.share(data1);

      const result2 = await core.share(data2);
      expect(result2).toBeNull();
      expect(core.error).toBeInstanceOf(DOMException);
      expect((core.error as DOMException).name).toBe("InvalidStateError");
      expect(core.cancelled).toBe(false);

      resolveFirst();
      const result1 = await p1;

      // Regression guard: bumping `_gen` on every share() start (the bug)
      // made the still-pending first call's captured `gen` stale by the time
      // the second call's failure ran, so the first call's later genuine
      // success was wrongly dropped (result/value stayed null/unset). Per
      // docs/web-share-tag-design.md §2, share() intentionally has no
      // fetch-style supersession — only dispose() may invalidate a call.
      expect(result1).toEqual(data1);
      expect(core.value).toEqual(data1);
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
