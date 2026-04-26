import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StorageCore } from "../src/core/StorageCore";

describe("StorageCore", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("EventTargetを継承している", () => {
    const core = new StorageCore();
    expect(core).toBeInstanceOf(EventTarget);
  });

  it("wcBindableプロパティが正しく定義されている", () => {
    expect(StorageCore.wcBindable.protocol).toBe("wc-bindable");
    expect(StorageCore.wcBindable.version).toBe(1);
    expect(StorageCore.wcBindable.properties).toHaveLength(3);
    expect(StorageCore.wcBindable.properties[0].name).toBe("value");
    expect(StorageCore.wcBindable.properties[1].name).toBe("loading");
    expect(StorageCore.wcBindable.properties[2].name).toBe("error");
  });

  it("valueのgetterがdetailを返す", () => {
    const getter = StorageCore.wcBindable.properties[0].getter!;
    const event = new CustomEvent("wcs-storage:value-changed", { detail: { count: 1 } });
    expect(getter(event)).toEqual({ count: 1 });
  });

  it("初期状態が正しい", () => {
    const core = new StorageCore();
    expect(core.value).toBeNull();
    expect(core.loading).toBe(false);
    expect(core.error).toBeNull();
    expect(core.key).toBe("");
    expect(core.type).toBe("local");
  });

  it("key未指定時にload()でエラーをスローする", () => {
    const core = new StorageCore();
    expect(() => core.load()).toThrow("[@wcstack/storage] key is required.");
  });

  it("key未指定時にsave()でエラーをスローする", () => {
    const core = new StorageCore();
    expect(() => core.save({ data: "test" })).toThrow("[@wcstack/storage] key is required.");
  });

  it("key未指定時にremove()でエラーをスローする", () => {
    const core = new StorageCore();
    expect(() => core.remove()).toThrow("[@wcstack/storage] key is required.");
  });

  it("無効なstorageタイプでエラーをスローする", () => {
    const core = new StorageCore();
    expect(() => { core.type = "invalid" as any; }).toThrow('Invalid storage type: "invalid"');
  });

  it("localStorageにJSONオブジェクトを保存・読み込みできる", () => {
    const core = new StorageCore();
    core.key = "test-key";
    core.type = "local";

    core.save({ name: "太郎", age: 30 });
    expect(localStorage.getItem("test-key")).toBe('{"name":"太郎","age":30}');

    const result = core.load();
    expect(result).toEqual({ name: "太郎", age: 30 });
    expect(core.value).toEqual({ name: "太郎", age: 30 });
  });

  it("sessionStorageに保存・読み込みできる", () => {
    const core = new StorageCore();
    core.key = "session-key";
    core.type = "session";

    core.save({ session: true });
    expect(sessionStorage.getItem("session-key")).toBe('{"session":true}');

    const result = core.load();
    expect(result).toEqual({ session: true });
  });

  it("文字列をそのまま保存できる", () => {
    const core = new StorageCore();
    core.key = "str-key";
    core.save("plain text");
    expect(localStorage.getItem("str-key")).toBe("plain text");

    const result = core.load();
    expect(result).toBe("plain text");
  });

  it("数値を保存・読み込みできる", () => {
    const core = new StorageCore();
    core.key = "num-key";
    core.save(42);
    expect(localStorage.getItem("num-key")).toBe("42");

    const result = core.load();
    expect(result).toBe(42);
  });

  it("配列を保存・読み込みできる", () => {
    const core = new StorageCore();
    core.key = "arr-key";
    core.save([1, 2, 3]);

    const result = core.load();
    expect(result).toEqual([1, 2, 3]);
  });

  it("booleanを保存・読み込みできる", () => {
    const core = new StorageCore();
    core.key = "bool-key";
    core.save(true);

    const result = core.load();
    expect(result).toBe(true);
  });

  it("nullを保存するとストレージからキーが削除される", () => {
    const core = new StorageCore();
    core.key = "null-key";
    core.save({ data: "exists" });
    expect(localStorage.getItem("null-key")).not.toBeNull();

    core.save(null);
    expect(localStorage.getItem("null-key")).toBeNull();
    expect(core.value).toBeNull();
  });

  it("undefinedを保存するとストレージからキーが削除される", () => {
    const core = new StorageCore();
    core.key = "undef-key";
    core.save("exists");

    core.save(undefined);
    expect(localStorage.getItem("undef-key")).toBeNull();
  });

  it("存在しないキーのload()はnullを返す", () => {
    const core = new StorageCore();
    core.key = "nonexistent";

    const result = core.load();
    expect(result).toBeNull();
    expect(core.value).toBeNull();
  });

  it("JSON以外の文字列はそのまま返す", () => {
    const core = new StorageCore();
    core.key = "raw-key";
    localStorage.setItem("raw-key", "not json");

    const result = core.load();
    expect(result).toBe("not json");
  });

  it("remove()でストレージからキーを削除し、valueをnullにする", () => {
    const core = new StorageCore();
    core.key = "remove-key";
    core.save({ data: "test" });
    expect(core.value).toEqual({ data: "test" });

    core.remove();
    expect(localStorage.getItem("remove-key")).toBeNull();
    expect(core.value).toBeNull();
  });

  it("target未指定時はイベントが自身にディスパッチされる", () => {
    const core = new StorageCore();
    core.key = "event-key";

    const events: string[] = [];
    core.addEventListener("wcs-storage:loading-changed", () => events.push("loading"));
    core.addEventListener("wcs-storage:value-changed", () => events.push("value"));

    core.save({ test: true });

    expect(events).toEqual(["loading", "value", "loading"]);
  });

  it("target指定時はイベントがtargetにディスパッチされる", () => {
    const target = new EventTarget();
    const core = new StorageCore(target);
    core.key = "target-key";

    const coreEvents: string[] = [];
    const targetEvents: string[] = [];

    core.addEventListener("wcs-storage:value-changed", () => coreEvents.push("value"));
    target.addEventListener("wcs-storage:value-changed", () => targetEvents.push("value"));

    core.save({ data: "test" });

    expect(coreEvents).toEqual([]);
    expect(targetEvents).toEqual(["value"]);
  });

  it("load()時にloading→value→loadingの順でイベントが発火する", () => {
    const core = new StorageCore();
    core.key = "load-event-key";
    localStorage.setItem("load-event-key", '{"loaded":true}');

    const events: string[] = [];
    core.addEventListener("wcs-storage:loading-changed", () => events.push("loading"));
    core.addEventListener("wcs-storage:value-changed", () => events.push("value"));
    core.addEventListener("wcs-storage:error", () => events.push("error"));

    core.load();

    // loading(true), error(null), value, loading(false)
    expect(events).toEqual(["loading", "error", "value", "loading"]);
  });

  it("save()時にloading→value→loadingの順でイベントが発火する", () => {
    const core = new StorageCore();
    core.key = "save-event-key";

    const events: string[] = [];
    core.addEventListener("wcs-storage:loading-changed", () => events.push("loading"));
    core.addEventListener("wcs-storage:value-changed", () => events.push("value"));
    core.addEventListener("wcs-storage:error", () => events.push("error"));

    core.save({ saved: true });

    // loading(true), error(null), value, loading(false)
    expect(events).toEqual(["loading", "error", "value", "loading"]);
  });

  it("save()でストレージエラーが発生した場合にerrorが設定される", () => {
    const core = new StorageCore();
    core.key = "error-save-key";

    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: { setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {}, getItem: () => null },
      configurable: true,
    });

    core.save({ large: "data" });
    expect(core.error).toBeInstanceOf(Error);
    expect(core.loading).toBe(false);

    Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
  });

  it("remove()でストレージエラーが発生した場合にerrorが設定される", () => {
    const core = new StorageCore();
    core.key = "error-remove-key";

    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: { removeItem: () => { throw new Error("SecurityError"); }, setItem: () => {}, getItem: () => null },
      configurable: true,
    });

    core.remove();
    expect(core.error).toBeInstanceOf(Error);
    expect(core.loading).toBe(false);

    Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
  });

  it("load()でストレージエラーが発生した場合にerrorが設定される", () => {
    const core = new StorageCore();
    core.key = "error-load-key";

    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => { throw new Error("SecurityError"); }, setItem: () => {}, removeItem: () => {} },
      configurable: true,
    });

    const result = core.load();
    expect(result).toBeNull();
    expect(core.error).toBeInstanceOf(Error);
    expect(core.loading).toBe(false);

    Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
  });

  it("DOM非依存でNode.jsランタイムでも動作可能", () => {
    const core = new StorageCore();
    expect(core).toBeInstanceOf(EventTarget);
    expect(core).not.toBeInstanceOf(HTMLElement);
  });

  describe("cross-tab sync", () => {
    it("startSync()でstorageイベントを監視開始する", () => {
      const core = new StorageCore();
      core.key = "sync-key";
      core.type = "local";
      core.startSync();

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      // storageイベントをシミュレート
      const event = new StorageEvent("storage", {
        key: "sync-key",
        newValue: '{"synced":true}',
        storageArea: localStorage,
      });
      globalThis.dispatchEvent(event);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ synced: true });
      expect(core.value).toEqual({ synced: true });

      core.stopSync();
    });

    it("関係ないキーのstorageイベントは無視する", () => {
      const core = new StorageCore();
      core.key = "my-key";
      core.type = "local";
      core.startSync();

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      const event = new StorageEvent("storage", {
        key: "other-key",
        newValue: '{"other":true}',
        storageArea: localStorage,
      });
      globalThis.dispatchEvent(event);

      expect(events).toHaveLength(0);

      core.stopSync();
    });

    it("sessionStorage使用時はstorageイベントを無視する", () => {
      const core = new StorageCore();
      core.key = "session-sync-key";
      core.type = "session";
      core.startSync();

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      const event = new StorageEvent("storage", {
        key: "session-sync-key",
        newValue: '{"synced":true}',
        storageArea: sessionStorage,
      });
      globalThis.dispatchEvent(event);

      expect(events).toHaveLength(0);

      core.stopSync();
    });

    it("newValueがnullの場合はvalueをnullにする", () => {
      const core = new StorageCore();
      core.key = "null-sync-key";
      core.type = "local";
      core.startSync();

      const event = new StorageEvent("storage", {
        key: "null-sync-key",
        newValue: null,
        storageArea: localStorage,
      });
      globalThis.dispatchEvent(event);

      expect(core.value).toBeNull();

      core.stopSync();
    });

    it("JSON以外のnewValueはそのまま文字列として設定する", () => {
      const core = new StorageCore();
      core.key = "raw-sync-key";
      core.type = "local";
      core.startSync();

      const event = new StorageEvent("storage", {
        key: "raw-sync-key",
        newValue: "not json",
        storageArea: localStorage,
      });
      globalThis.dispatchEvent(event);

      expect(core.value).toBe("not json");

      core.stopSync();
    });

    it("stopSync()でstorageイベントの監視を停止する", () => {
      const core = new StorageCore();
      core.key = "stop-sync-key";
      core.type = "local";
      core.startSync();
      core.stopSync();

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      const event = new StorageEvent("storage", {
        key: "stop-sync-key",
        newValue: '{"synced":true}',
        storageArea: localStorage,
      });
      globalThis.dispatchEvent(event);

      expect(events).toHaveLength(0);
    });

    it("startSync()を2回呼んでも二重登録されない", () => {
      const core = new StorageCore();
      core.key = "double-sync-key";
      core.type = "local";
      core.startSync();
      core.startSync();

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      const event = new StorageEvent("storage", {
        key: "double-sync-key",
        newValue: '{"synced":true}',
        storageArea: localStorage,
      });
      globalThis.dispatchEvent(event);

      expect(events).toHaveLength(1);

      core.stopSync();
    });

    it("stopSync()を未登録時に呼んでもエラーにならない", () => {
      const core = new StorageCore();
      expect(() => core.stopSync()).not.toThrow();
    });
  });
});
