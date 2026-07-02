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
    it("properties が value/loading/error/cancelled を宣言している", () => {
      const names = ContactsCore.wcBindable.properties.map((p) => p.name);
      expect(names).toEqual(["value", "loading", "error", "cancelled"]);
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

    it("進行中に重ねて select() を呼んでも2回目の loading=true は同値ガードで再発火しない", async () => {
      let resolveFirst!: (c: any[]) => void;
      let resolveSecond!: (c: any[]) => void;
      let call = 0;
      installSelect(() => new Promise<any[]>((resolve) => {
        call += 1;
        if (call === 1) resolveFirst = resolve;
        else resolveSecond = resolve;
      }));
      const core = new ContactsCore();
      const loadingEvents: boolean[] = [];
      core.addEventListener("wcs-contacts:loading-changed", (e) => loadingEvents.push((e as CustomEvent).detail));

      const p1 = core.select(["name"]);
      expect(loadingEvents).toEqual([true]);
      const p2 = core.select(["email"]);
      // 2回目の _setLoading(true) は同値なので追加のイベントは発火しない
      expect(loadingEvents).toEqual([true]);

      resolveFirst([{ name: ["A"] }]);
      await p1;
      resolveSecond([{ name: ["B"] }]);
      await p2;

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

  describe("_gen 世代ガード", () => {
    it("dispose 後に resolve した stale な select() は状態を書かない", async () => {
      let resolveSelect!: (contacts: any[]) => void;
      installSelect(() => new Promise<any[]>((resolve) => { resolveSelect = resolve; }));
      const core = new ContactsCore();

      const promise = core.select(["name"]);
      expect(core.loading).toBe(true);

      core.dispose(); // _gen を進める
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
