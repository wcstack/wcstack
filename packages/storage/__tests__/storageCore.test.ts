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

  it("wcBindable inputsがkey/typeを宣言している", () => {
    const inputs = StorageCore.wcBindable.inputs!;
    expect(inputs.map((i) => i.name)).toEqual(["key", "type"]);
    // Core は headless なので attribute ヒントは持たない
    expect(inputs.every((i) => i.attribute === undefined)).toBe(true);
  });

  it("wcBindable commandsがload/save/removeを宣言している", () => {
    const commands = StorageCore.wcBindable.commands!;
    expect(commands.map((c) => c.name)).toEqual(["load", "save", "remove"]);
    // load / save / remove は同期メソッドなので async ヒントを持たない
    expect(commands.every((c) => c.async === undefined)).toBe(true);
  });

  it("wcBindable inputs/commandsのnameがそれぞれ一意である", () => {
    const inputNames = StorageCore.wcBindable.inputs!.map((i) => i.name);
    const commandNames = StorageCore.wcBindable.commands!.map((c) => c.name);
    expect(new Set(inputNames).size).toBe(inputNames.length);
    expect(new Set(commandNames).size).toBe(commandNames.length);
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

  it("key未指定時のload()はthrowせずerrorへ流しnullを返す（never-throw）", () => {
    const core = new StorageCore();
    let result: any;
    expect(() => { result = core.load(); }).not.toThrow();
    expect(result).toBeNull();
    expect(core.error).toEqual({ operation: "load", message: "key is required." });
  });

  it("key未指定時のsave()はthrowせずerrorへ流す（never-throw）", () => {
    const core = new StorageCore();
    expect(() => core.save({ data: "test" })).not.toThrow();
    expect(core.error).toEqual({ operation: "save", message: "key is required." });
  });

  it("key未指定時のremove()はthrowせずerrorへ流す（never-throw）", () => {
    const core = new StorageCore();
    expect(() => core.remove()).not.toThrow();
    expect(core.error).toEqual({ operation: "remove", message: "key is required." });
  });

  it("無効なstorageタイプはthrowせずerrorへ流し、typeは現状維持する（never-throw）", () => {
    const core = new StorageCore();
    expect(() => { core.type = "invalid" as any; }).not.toThrow();
    expect(core.error).toEqual({ operation: "type", message: 'Invalid storage type: "invalid". Must be "local" or "session".' });
    // 無効値は無視され、デフォルトの "local" が維持される
    expect(core.type).toBe("local");
  });

  it("key setterは非文字列をStringへ正規化する", () => {
    const core = new StorageCore();
    core.key = 123 as any;
    expect(core.key).toBe("123");
    expect(typeof core.key).toBe("string");
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

  it("undefinedを保存するとvalueはundefinedではなくnullへ正規化される", () => {
    const core = new StorageCore();
    core.key = "undef-normalize-key";

    core.save(undefined);
    // getter は undefined ではなく null を返す（remove()/欠損キーの load() と整合）
    expect(core.value).toBeNull();
  });

  it("nullを保存するとvalueがnullになる", () => {
    const core = new StorageCore();
    core.key = "null-normalize-key";
    core.save({ data: true });

    core.save(null);
    expect(core.value).toBeNull();
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

    // loading(true), value, loading(false)。開始時の error(null) クリアは
    // 同値ガードで抑止される（error は既に null のため）
    expect(events).toEqual(["loading", "value", "loading"]);
  });

  it("save()時にloading→value→loadingの順でイベントが発火する", () => {
    const core = new StorageCore();
    core.key = "save-event-key";

    const events: string[] = [];
    core.addEventListener("wcs-storage:loading-changed", () => events.push("loading"));
    core.addEventListener("wcs-storage:value-changed", () => events.push("value"));
    core.addEventListener("wcs-storage:error", () => events.push("error"));

    core.save({ saved: true });

    // loading(true), value, loading(false)。開始時の error(null) クリアは
    // 同値ガードで抑止される（error は既に null のため）
    expect(events).toEqual(["loading", "value", "loading"]);
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
    expect(core.error).toEqual({ operation: "save", message: "QuotaExceededError" });
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
    expect(core.error).toEqual({ operation: "remove", message: "SecurityError" });
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
    expect(core.error).toEqual({ operation: "load", message: "SecurityError" });
    expect(core.loading).toBe(false);

    Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
  });

  it("循環参照オブジェクトのsaveでJSON.stringifyのTypeErrorがsaveエラーとして捕捉される", () => {
    const core = new StorageCore();
    core.key = "circular-key";

    const obj: any = {};
    obj.self = obj; // 循環参照 → JSON.stringify が TypeError を投げる

    core.save(obj);

    expect(core.error.operation).toBe("save");
    expect(core.error.message).toContain("circular");
    expect(core.loading).toBe(false);
    // ストレージには書き込まれない
    expect(localStorage.getItem("circular-key")).toBeNull();
  });

  it("Error以外の値がthrowされた場合はString化してmessageに格納する", () => {
    const core = new StorageCore();
    core.key = "non-error-throw-key";

    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      value: { setItem: () => { throw "raw string failure"; }, removeItem: () => {}, getItem: () => null },
      configurable: true,
    });

    core.save({ data: true });
    expect(core.error).toEqual({ operation: "save", message: "raw string failure" });

    Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
  });

  it("DOM非依存でNode.jsランタイムでも動作可能", () => {
    const core = new StorageCore();
    expect(core).toBeInstanceOf(EventTarget);
    expect(core).not.toBeInstanceOf(HTMLElement);
  });

  describe("value setter (staging, no persistence)", () => {
    it("value setterは値を設定しvalue-changedを発火するがストレージへは書き込まない", () => {
      const core = new StorageCore();
      core.key = "stage-key";

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      core.value = { staged: true };

      expect(core.value).toEqual({ staged: true });
      expect(events).toEqual([{ staged: true }]);
      // ストレージには書き込まれない
      expect(localStorage.getItem("stage-key")).toBeNull();
    });

    it("同一値の代入はvalue-changedをスキップする（フィードバックループ防止）", () => {
      const core = new StorageCore();

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      const obj = { same: true };
      core.value = obj;
      core.value = obj; // 同一参照なのでスキップ

      expect(events).toHaveLength(1);
    });

    it("初期nullと同一のnull代入はスキップされる", () => {
      const core = new StorageCore();

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      core.value = null; // 初期値もnullなのでスキップ
      expect(events).toHaveLength(0);
      expect(core.value).toBeNull();
    });

    it("value setterでステージングした値をsave()でコミットできる", () => {
      const core = new StorageCore();
      core.key = "stage-commit-key";

      core.value = { committed: false };
      expect(localStorage.getItem("stage-commit-key")).toBeNull();

      // 現在のステージング値を保存
      core.save(core.value);
      expect(localStorage.getItem("stage-commit-key")).toBe('{"committed":false}');
    });
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

    it("クロスタブ同期成功時に直前のerrorがnullへクリアされる", () => {
      const core = new StorageCore();
      core.key = "sync-error-clear-key";
      core.type = "local";
      core.startSync();

      // 直前のloadを失敗させてerrorを残す
      const original = globalThis.localStorage;
      Object.defineProperty(globalThis, "localStorage", {
        value: { getItem: () => { throw new Error("SecurityError"); }, setItem: () => {}, removeItem: () => {} },
        configurable: true,
      });
      core.load();
      Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
      expect(core.error).toEqual({ operation: "load", message: "SecurityError" });

      // 他タブからの更新が来るとerrorがクリアされ、新しいvalueが反映される
      const event = new StorageEvent("storage", {
        key: "sync-error-clear-key",
        newValue: '{"fresh":true}',
        storageArea: localStorage,
      });
      globalThis.dispatchEvent(event);

      expect(core.error).toBeNull();
      expect(core.value).toEqual({ fresh: true });

      core.stopSync();
    });

    it("クロスタブ同期成功時に残存errorがnullへクリアされてイベント発火し、error既にnullなら同値ガードで発火しない", () => {
      const core = new StorageCore();
      core.load(); // key 未設定 → error = { operation: "load", ... } を残存させる
      core.key = "sync-error-event-key";
      core.type = "local";
      core.startSync();

      const errorEvents: any[] = [];
      core.addEventListener("wcs-storage:error", (e: Event) => {
        errorEvents.push((e as CustomEvent).detail);
      });

      const event = new StorageEvent("storage", {
        key: "sync-error-event-key",
        newValue: '{"x":1}',
        storageArea: localStorage,
      });
      globalThis.dispatchEvent(event);

      // 同期成功時に残存 error が null へリセットされたことが観測できる
      expect(errorEvents).toEqual([null]);
      expect(core.error).toBeNull();

      // 2回目の同期: error は既に null → 同値ガードで再発火しない
      globalThis.dispatchEvent(new StorageEvent("storage", {
        key: "sync-error-event-key",
        newValue: '{"x":2}',
        storageArea: localStorage,
      }));
      expect(errorEvents).toEqual([null]);

      core.stopSync();
    });
  });

  describe("ライフサイクル (ready / observe / dispose)", () => {
    it("readyは解決済みPromiseを返す（同期アクセスのため即時ready）", async () => {
      const core = new StorageCore();
      await expect(core.ready).resolves.toBeUndefined();
    });

    it("observe()はreadyを返し、冪等に再呼び出しできる", async () => {
      const core = new StorageCore();
      await expect(core.observe()).resolves.toBeUndefined();
      await expect(core.observe()).resolves.toBeUndefined();
    });

    it("dispose()はクロスタブ同期を停止する", () => {
      const core = new StorageCore();
      core.key = "dispose-stop-key";
      core.type = "local";
      core.startSync();

      core.dispose();

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      // dispose後はリスナが解除されているのでstorageイベントは無視される
      const event = new StorageEvent("storage", {
        key: "dispose-stop-key",
        newValue: '{"synced":true}',
        storageArea: localStorage,
      });
      globalThis.dispatchEvent(event);

      expect(events).toHaveLength(0);
    });

    it("dispose後に配送された古い世代のstorageイベントは状態を書かない（_genガード）", () => {
      const core = new StorageCore();
      core.key = "stale-gen-key";
      core.type = "local";
      core.startSync();

      // dispose() より前に捕捉したリスナ参照（実装の世代ガードを直接検証するため、
      // stopSync を回避して dispose の _gen++ だけを効かせる）
      const listener = (core as any)._storageListener as (e: StorageEvent) => void;

      // _gen のみをインクリメントして「古い世代のコールバック」を再現する
      (core as any)._gen++;

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      // 捕捉済みの古いリスナを直接呼んでも、世代不一致で何も書き込まれない
      listener(new StorageEvent("storage", {
        key: "stale-gen-key",
        newValue: '{"stale":true}',
        storageArea: localStorage,
      }));

      expect(events).toHaveLength(0);
      expect(core.value).toBeNull();

      core.stopSync();
    });

    it("dispose後にstartSync()で再購読できる（dispose→observe復活）", () => {
      const core = new StorageCore();
      core.key = "revive-key";
      core.type = "local";
      core.startSync();
      core.dispose();

      // 再購読
      core.startSync();

      const events: any[] = [];
      core.addEventListener("wcs-storage:value-changed", (e: Event) => {
        events.push((e as CustomEvent).detail);
      });

      const event = new StorageEvent("storage", {
        key: "revive-key",
        newValue: '{"revived":true}',
        storageArea: localStorage,
      });
      globalThis.dispatchEvent(event);

      expect(events).toHaveLength(1);
      expect(core.value).toEqual({ revived: true });

      core.stopSync();
    });
  });
});
