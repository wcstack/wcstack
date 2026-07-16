import { describe, it, expect, afterEach, vi } from "vitest";
import { ContactsCore } from "../src/core/ContactsCore";
import { installSelect, removeContacts } from "./mocks";

describe("ContactsCore", () => {
  afterEach(() => {
    removeContacts();
    vi.restoreAllMocks();
  });

  it("EventTarget を継承している", () => {
    const core = new ContactsCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  describe("wcBindable プロトコル宣言", () => {
    it("properties が value/loading/error/cancelled/errorInfo を宣言している", () => {
      const names = ContactsCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["value", "loading", "error", "cancelled", "errorInfo"]);
    });

    it("errorInfo の event が wcs-contacts:error-info-changed で getter を持たない（detail が値）", () => {
      const prop = ContactsCore.wcBindable.properties.find((p) => p.name === "errorInfo")!;
      expect(prop.event).toBe("wcs-contacts:error-info-changed");
      expect(prop.getter).toBeUndefined();
    });

    it("value の event が wcs-contacts:complete で getter が detail.value を返す", () => {
      const prop = ContactsCore.wcBindable.properties.find((p) => p.name === "value")!;
      expect(prop.event).toBe("wcs-contacts:complete");
      const contacts = [{ name: ["Taro Yamada"] }];
      const ev = new CustomEvent("wcs-contacts:complete", { detail: { value: contacts } });
      expect(prop.getter!(ev)).toEqual(contacts);
    });

    it("loading の event が wcs-contacts:loading-changed", () => {
      const prop = ContactsCore.wcBindable.properties.find((p) => p.name === "loading")!;
      expect(prop.event).toBe("wcs-contacts:loading-changed");
    });

    it("error の event が wcs-contacts:error", () => {
      const prop = ContactsCore.wcBindable.properties.find((p) => p.name === "error")!;
      expect(prop.event).toBe("wcs-contacts:error");
    });

    it("cancelled の event が wcs-contacts:cancelled-changed", () => {
      const prop = ContactsCore.wcBindable.properties.find((p) => p.name === "cancelled")!;
      expect(prop.event).toBe("wcs-contacts:cancelled-changed");
    });

    it("commands は select(async) のみを宣言している（abort コマンドは持たない）", () => {
      const commands = ContactsCore.wcBindable.commands!;
      expect(commands.map((c) => c.name)).toEqual(["select"]);
      expect(commands.find((c) => c.name === "select")!.async).toBe(true);
    });

    it("protocol/version が固定値", () => {
      expect(ContactsCore.wcBindable.protocol).toBe("wc-bindable");
      expect(ContactsCore.wcBindable.version).toBe(1);
    });
  });

  describe("初期状態", () => {
    it("value/loading/error/cancelled が既定値", () => {
      const core = new ContactsCore();
      expect(core.value).toBeNull();
      expect(core.loading).toBe(false);
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(false);
    });

    it("ready は即 resolve する（非同期 probe が無いため）", async () => {
      const core = new ContactsCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe() は ready を返し、冪等に再呼び出しできる", async () => {
      const core = new ContactsCore();
      await expect(core.observe()).resolves.toBeUndefined();
      await expect(core.observe()).resolves.toBeUndefined();
    });
  });

  describe("select() 成功時", () => {
    it("value に選択されたcontactの配列が入り、loading が true→false と遷移する", async () => {
      const contacts = [{ name: ["Taro Yamada"], tel: ["090-1234-5678"] }];
      installSelect(() => Promise.resolve(contacts));
      const core = new ContactsCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-contacts:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const result = await core.select(["name", "tel"]);

      expect(result).toEqual(contacts);
      expect(core.value).toEqual(contacts);
      expect(core.loading).toBe(false);
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(false);
      expect(loadingEvents).toEqual([true, false]);
    });

    it("2つの位置引数（properties, options）がそのまま select() へ渡る", async () => {
      const fn = installSelect(() => Promise.resolve([]));
      const core = new ContactsCore();
      await core.select(["name", "email"], { multiple: true });
      expect(fn).toHaveBeenCalledWith(["name", "email"], { multiple: true });
    });

    it("options 省略時（1引数呼び出し）でも動作する", async () => {
      const fn = installSelect(() => Promise.resolve([]));
      const core = new ContactsCore();
      await core.select(["name"]);
      expect(fn).toHaveBeenCalledWith(["name"], undefined);
    });

    it("multiple: false（既定）でも value は配列のまま", async () => {
      const single = [{ name: ["Taro Yamada"] }];
      installSelect(() => Promise.resolve(single));
      const core = new ContactsCore();
      const result = await core.select(["name"], { multiple: false });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });

    it("wcs-contacts:complete イベントの detail.value が結果と一致する", async () => {
      const contacts = [{ name: ["Taro Yamada"] }];
      installSelect(() => Promise.resolve(contacts));
      const core = new ContactsCore();
      const completes: any[] = [];
      core.addEventListener("wcs-contacts:complete", (e) => completes.push((e as CustomEvent).detail));

      await core.select(["name"]);

      expect(completes).toEqual([{ value: contacts }]);
    });

    it("進行中に重ねて select() を呼ぶと exhaust で2回目は no-op（picker は1回のみ・loading 再発火なし）", async () => {
      // 1呼び出し=1ピッカー（docs/contact-picker-tag-design.md §1、単一システムモーダル面）を
      // lane の exhaust policy がクライアント側で強制する。進行中の2回目は begin() が null を
      // 返し ticket 化されず、navigator.contacts.select すら呼ばれない（旧実装はプラット
      // フォームの InvalidStateError 依存）。
      let resolveFirst!: (c: any[]) => void;
      let call = 0;
      installSelect(() => new Promise<any[]>((resolve) => { call += 1; resolveFirst = resolve; }));
      const core = new ContactsCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-contacts:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const p1 = core.select(["name"]);
      expect(loadingEvents).toEqual([true]);

      // exhaust: 進行中なので2回目は即 null（select を呼ばず loading も再発火しない）
      const result2 = await core.select(["email"]);
      expect(result2).toBeNull();
      expect(call).toBe(1);
      expect(loadingEvents).toEqual([true]);

      resolveFirst([{ name: ["A"] }]);
      await p1;
      expect(loadingEvents).toEqual([true, false]);
    });

    it("同一参照の value が続けて resolve されても再 dispatch しない（同値ガード）", async () => {
      const sameContacts = [{ name: ["Taro Yamada"] }];
      installSelect(() => Promise.resolve(sameContacts));
      const core = new ContactsCore();
      await core.select(["name"]);
      const completes: any[] = [];
      core.addEventListener("wcs-contacts:complete", (e) => completes.push((e as CustomEvent).detail));

      await core.select(["name"]);

      expect(completes).toEqual([]);
    });

    it("target 指定時はイベントが target にディスパッチされる", async () => {
      installSelect(() => Promise.resolve([]));
      const target = new EventTarget();
      const core = new ContactsCore(target);
      const coreEvents: string[] = [];
      const targetEvents: string[] = [];
      core.addEventListener("wcs-contacts:complete", () => coreEvents.push("complete"));
      target.addEventListener("wcs-contacts:complete", () => targetEvents.push("complete"));

      await core.select(["name"]);

      expect(coreEvents).toEqual([]);
      expect(targetEvents).toEqual(["complete"]);
    });
  });

  describe("AbortError（ユーザーキャンセル）", () => {
    it("cancelled が true になり error は変化しない", async () => {
      installSelect(() => Promise.reject(new DOMException("Picker canceled", "AbortError")));
      const core = new ContactsCore();

      const result = await core.select(["name"]);

      expect(result).toBeNull();
      expect(core.cancelled).toBe(true);
      expect(core.error).toBeNull();
      expect(core.loading).toBe(false);
    });

    it("wcs-contacts:cancelled-changed が発火し wcs-contacts:error は発火しない", async () => {
      installSelect(() => Promise.reject(new DOMException("Picker canceled", "AbortError")));
      const core = new ContactsCore();
      const cancelledEvents: boolean[] = [];
      const errorEvents: any[] = [];
      core.addEventListener("wcs-contacts:cancelled-changed", (e) => cancelledEvents.push((e as CustomEvent).detail));
      core.addEventListener("wcs-contacts:error", (e) => errorEvents.push((e as CustomEvent).detail));

      await core.select(["name"]);

      expect(cancelledEvents).toEqual([true]);
      expect(errorEvents).toEqual([]);
    });
  });

  describe("AbortError 以外の例外（真の失敗）", () => {
    it("error が設定され cancelled は false のまま", async () => {
      installSelect(() => Promise.reject(new DOMException("Permission denied", "NotAllowedError")));
      const core = new ContactsCore();

      const result = await core.select(["name"]);

      expect(result).toBeNull();
      expect(core.error).toBeInstanceOf(DOMException);
      expect(core.cancelled).toBe(false);
      expect(core.loading).toBe(false);
    });

    it("name プロパティを持たない一般的な Error でも error に落ちる", async () => {
      installSelect(() => Promise.reject(new TypeError("boom")));
      const core = new ContactsCore();

      const result = await core.select(["name"]);

      expect(result).toBeNull();
      expect(core.error).toBeInstanceOf(TypeError);
      expect(core.cancelled).toBe(false);
    });
  });

  describe("次回 select() でのリセット", () => {
    it("前回 cancelled が今回成功時にリセットされる", async () => {
      const fn = installSelect(() => Promise.resolve([]));
      fn.mockRejectedValueOnce(new DOMException("Picker canceled", "AbortError"));
      const core = new ContactsCore();

      await core.select(["name"]);
      expect(core.cancelled).toBe(true);

      await core.select(["name"]);
      expect(core.cancelled).toBe(false);
    });

    it("前回 error が今回成功時にリセットされる", async () => {
      const fn = installSelect(() => Promise.resolve([]));
      fn.mockRejectedValueOnce(new DOMException("boom", "NotAllowedError"));
      const core = new ContactsCore();

      await core.select(["name"]);
      expect(core.error).not.toBeNull();

      await core.select(["name"]);
      expect(core.error).toBeNull();
    });
  });

  describe("unsupported 環境（Android Chrome 以外の既定状態）", () => {
    it("navigator.contacts 不在時は即 error になり loading は true にすらならない", async () => {
      removeContacts();
      const core = new ContactsCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-contacts:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const result = await core.select(["name"]);

      expect(result).toBeNull();
      expect(core.error).toEqual({ message: "Contact Picker API is not supported in this browser." });
      expect(core.loading).toBe(false);
      expect(loadingEvents).toEqual([]);
      // capability-missing taxonomy（既存 error shape は不変・errorInfo は追加）
      expect(core.errorInfo).toEqual({
        code: "capability-missing", phase: "start", recoverable: false,
        capabilityId: "web.contacts",
        message: "Contact Picker API is not supported in this browser.",
      });
      expect(core.supported).toBe(false);
      expect(core.platformAssessment.readiness).toBe("idle");
    });

    it("navigator.contacts はあるが select が関数でない場合も即 error", async () => {
      Object.defineProperty(navigator, "contacts", {
        value: {},
        configurable: true,
        writable: true,
      });
      const core = new ContactsCore();
      const result = await core.select(["name"]);
      expect(result).toBeNull();
      expect(core.error).toEqual({ message: "Contact Picker API is not supported in this browser." });
    });
  });

  describe("dispose 世代ガード（lane owner generation）", () => {
    it("dispose 後に resolve した stale な select() は状態を書かない", async () => {
      let resolveSelect!: (contacts: any[]) => void;
      installSelect(() => new Promise<any[]>((resolve) => { resolveSelect = resolve; }));
      const core = new ContactsCore();

      const promise = core.select(["name"]);
      expect(core.loading).toBe(true);

      core.dispose(); // lane owner generation を進める
      resolveSelect([{ name: ["Taro"] }]);

      const result = await promise;
      expect(result).toBeNull();
      expect(core.value).toBeNull();
    });

    it("dispose 後に reject（AbortError 以外）した stale な select() は状態を書かない", async () => {
      let rejectSelect!: (e: any) => void;
      installSelect(() => new Promise<any[]>((_resolve, reject) => { rejectSelect = reject; }));
      const core = new ContactsCore();

      const promise = core.select(["name"]);
      core.dispose();
      rejectSelect(new TypeError("boom"));

      const result = await promise;
      expect(result).toBeNull();
      expect(core.error).toBeNull();
    });

    it("dispose 後に reject（AbortError）した stale な select() は cancelled も書かない", async () => {
      let rejectSelect!: (e: any) => void;
      installSelect(() => new Promise<any[]>((_resolve, reject) => { rejectSelect = reject; }));
      const core = new ContactsCore();

      const promise = core.select(["name"]);
      core.dispose();
      rejectSelect(new DOMException("Picker canceled", "AbortError"));

      const result = await promise;
      expect(result).toBeNull();
      expect(core.cancelled).toBe(false);
    });

    it("dispose で loading=true が残った後、新しい select() の loading=true は同値ガードで再発火しない", async () => {
      let rejectFirst!: (e: any) => void;
      let first = true;
      installSelect(() => {
        if (first) { first = false; return new Promise<any[]>((_r, reject) => { rejectFirst = reject; }); }
        return Promise.resolve([{ name: ["B"] }]);
      });
      const core = new ContactsCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-contacts:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const p1 = core.select(["name"]);
      expect(loadingEvents).toEqual([true]);
      core.dispose();                    // loading=true のまま残る（stale は状態を書かない）
      rejectFirst(new TypeError("x"));
      await p1;
      expect(core.loading).toBe(true);

      // 新しい select(): _setLoading(true) は現在値と同値なので再発火せず、成功時の false のみ。
      const result = await core.select(["email"]);
      expect(result).toEqual([{ name: ["B"] }]);
      expect(loadingEvents).toEqual([true, false]);
    });
  });

  describe("並行 select() 呼び出し（exhaust: 2回目は no-op）", () => {
    it("1回目 pending 中の2回目は select を呼ばず即 null（InvalidStateError を招かない）で、1回目の成功は汚染されない", async () => {
      let resolveFirst!: (contacts: any[]) => void;
      let call = 0;
      installSelect(() => {
        call += 1;
        return new Promise<any[]>((resolve) => { resolveFirst = resolve; });
      });
      const core = new ContactsCore();

      const contacts1 = [{ name: ["Taro Yamada"] }];
      const p1 = core.select(["name"]);

      // exhaust: 進行中の2回目は ticket 化されず select すら呼ばれない。旧実装は2回目が
      // InvalidStateError で reject → setError で1回目の結果を汚染していた（バグ）。
      const result2 = await core.select(["name"]);
      expect(result2).toBeNull();
      expect(call).toBe(1);
      expect(core.error).toBeNull();
      expect(core.cancelled).toBe(false);

      resolveFirst(contacts1);
      const result1 = await p1;

      // 1回目の成功はクリーンに反映される（2回目に破棄も汚染もされない）。
      expect(result1).toEqual(contacts1);
      expect(core.value).toEqual(contacts1);
      expect(core.error).toBeNull();
    });
  });

  describe("errorInfo（bindable 出力・wcs-contacts:error-info-changed）", () => {
    it("真の失敗で errorInfo=select-failed が detail 付きで発火し、次の select 開始時に null で発火する", async () => {
      let call = 0;
      installSelect(() => {
        call += 1;
        return call === 1 ? Promise.reject(new TypeError("boom")) : Promise.resolve([{ name: ["A"] }]);
      });
      const core = new ContactsCore();
      const details: unknown[] = [];
      core.addEventListener("wcs-contacts:error-info-changed", (e) => details.push((e as CustomEvent).detail));

      await core.select(["name"]); // 失敗 → null→object で1回発火
      expect(details).toHaveLength(1);
      expect((details[0] as { code: string }).code).toBe("select-failed");
      expect(core.errorInfo?.recoverable).toBe(true);

      await core.select(["name"]); // 成功: 開始時に object→null クリアで1回発火
      expect(details).toHaveLength(2);
      expect(details[1]).toBeNull();
      expect(core.errorInfo).toBeNull();
    });

    it("エラーなしの成功では error-info-changed を発火しない（同値ガード）", async () => {
      installSelect(() => Promise.resolve([{ name: ["A"] }]));
      const core = new ContactsCore();
      const details: unknown[] = [];
      core.addEventListener("wcs-contacts:error-info-changed", (e) => details.push((e as CustomEvent).detail));

      await core.select(["name"]);
      expect(details).toHaveLength(0);
      expect(core.errorInfo).toBeNull();
    });

    it("ユーザーキャンセル（AbortError）は errorInfo を立てない", async () => {
      installSelect(() => Promise.reject(new DOMException("Picker canceled", "AbortError")));
      const core = new ContactsCore();
      await core.select(["name"]);
      expect(core.cancelled).toBe(true);
      expect(core.errorInfo).toBeNull();
    });

    it("イベントは bubbles する", async () => {
      installSelect(() => Promise.reject(new TypeError("boom")));
      const core = new ContactsCore();
      let bubbles = false;
      core.addEventListener("wcs-contacts:error-info-changed", (e) => { bubbles = e.bubbles; });
      await core.select(["name"]);
      expect(bubbles).toBe(true);
    });

    it("navigator.contacts.select があれば supported=true・readiness=ready", () => {
      installSelect(() => Promise.resolve([]));
      const core = new ContactsCore();
      expect(core.supported).toBe(true);
      expect(core.platformAssessment.readiness).toBe("ready");
      expect(core.platformAssessment.availability.get("web.contacts")).toBe("available");
    });

    it("message を持たない失敗は errorInfo.message を既定文言にフォールバックする", async () => {
      installSelect(() => Promise.reject({ name: "WeirdError" }));
      const core = new ContactsCore();
      await core.select(["name"]);
      expect(core.errorInfo).toEqual({ code: "select-failed", phase: "execute", recoverable: true, message: "Contact selection failed." });
      expect(core.error).toEqual({ name: "WeirdError" });
    });

    it("falsy な rejection(null)でも error は非 null envelope になり errorInfo と同期する", async () => {
      installSelect(() => Promise.reject(null));
      const core = new ContactsCore();
      await core.select(["name"]);
      expect(core.error).toEqual({ message: "Contact selection failed." });
      expect(core.errorInfo?.code).toBe("select-failed");
    });
  });

  describe("never-throw", () => {
    it("select() はどの経路でも例外を投げず常に resolve する", async () => {
      installSelect(() => Promise.reject(new Error("picker crashed")));
      const core = new ContactsCore();
      await expect(core.select(["name"])).resolves.toBeNull();
    });
  });

  describe("dispose()", () => {
    it("一度も select していない dispose は安全な no-op", () => {
      const core = new ContactsCore();
      expect(() => core.dispose()).not.toThrow();
    });
  });
});
