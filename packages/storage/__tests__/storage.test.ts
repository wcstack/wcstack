import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Storage } from "../src/components/Storage";
import { bootstrapStorage } from "../src/bootstrapStorage";
import { registerComponents } from "../src/registerComponents";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";
import { config, setConfig, getConfig } from "../src/config";

// registerComponents経由でカスタム要素を登録
registerComponents();

describe("config", () => {
  it("デフォルト設定を取得できる", () => {
    expect(config.tagNames.storage).toBe("wcs-storage");
    expect(config.autoTrigger).toBe(true);
    expect(config.triggerAttribute).toBe("data-storagetarget");
  });

  it("getConfig()でフリーズされたコピーを取得できる", () => {
    const frozen = getConfig();
    expect(frozen.tagNames.storage).toBe("wcs-storage");
    expect(Object.isFrozen(frozen)).toBe(true);
    // 2回目の呼び出しも同じオブジェクト
    const frozen2 = getConfig();
    expect(frozen).toBe(frozen2);
  });

  it("setConfig()で部分的に設定を変更できる", () => {
    setConfig({ autoTrigger: false });
    expect(config.autoTrigger).toBe(false);
    // 元に戻す
    setConfig({ autoTrigger: true });
    expect(config.autoTrigger).toBe(true);
  });

  it("setConfig()でtagNamesを変更できる", () => {
    setConfig({ tagNames: { storage: "my-storage" } });
    expect(config.tagNames.storage).toBe("my-storage");
    // 元に戻す
    setConfig({ tagNames: { storage: "wcs-storage" } });
  });

  it("setConfig()でtagNamesの非文字列値は無視され既存値を保持する", () => {
    // 指摘5: { storage: undefined } のような非文字列で汚染されると
    // customElements.define(undefined, …) が失敗する。typeofガードで弾く。
    setConfig({ tagNames: { storage: undefined as any } });
    expect(config.tagNames.storage).toBe("wcs-storage");

    setConfig({ tagNames: { storage: 123 as any } });
    expect(config.tagNames.storage).toBe("wcs-storage");

    // 正常な文字列は反映される
    setConfig({ tagNames: { storage: "x-storage" } });
    expect(config.tagNames.storage).toBe("x-storage");
    // 元に戻す
    setConfig({ tagNames: { storage: "wcs-storage" } });
  });

  it("setConfig()でtriggerAttributeを変更できる", () => {
    setConfig({ triggerAttribute: "data-trigger" });
    expect(config.triggerAttribute).toBe("data-trigger");
    // 元に戻す
    setConfig({ triggerAttribute: "data-storagetarget" });
  });

  it("setConfig()後にgetConfig()のキャッシュがリセットされる", () => {
    const frozen1 = getConfig();
    setConfig({ autoTrigger: false });
    const frozen2 = getConfig();
    expect(frozen1).not.toBe(frozen2);
    // 元に戻す
    setConfig({ autoTrigger: true });
  });
});

describe("Storage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  it("DOM追加時に非表示になる", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("manual", "");
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("wcBindableプロパティが正しく定義されている", () => {
    expect(Storage.wcBindable.protocol).toBe("wc-bindable");
    expect(Storage.wcBindable.version).toBe(1);
    expect(Storage.wcBindable.properties).toHaveLength(4);
    expect(Storage.wcBindable.properties[0].name).toBe("value");
    expect(Storage.wcBindable.properties[1].name).toBe("loading");
    expect(Storage.wcBindable.properties[2].name).toBe("error");
    expect(Storage.wcBindable.properties[3].name).toBe("trigger");
    expect(Storage.wcBindable.properties[3].event).toBe("wcs-storage:trigger-changed");
  });

  it("wcBindable inputsがShellの設定可能サーフェスを宣言している", () => {
    const inputs = Storage.wcBindable.inputs!;
    expect(inputs.map((i) => i.name)).toEqual(["key", "type", "value", "manual", "trigger"]);
  });

  it("wcBindable inputsはattributeヒントを持たない（setterが自己反映するため二重設定を避ける）", () => {
    const inputs = Storage.wcBindable.inputs!;
    expect(inputs.every((i) => i.attribute === undefined)).toBe(true);
  });

  it("wcBindable commandsをCoreからload/save/removeとして継承している", () => {
    const commands = Storage.wcBindable.commands!;
    expect(commands.map((c) => c.name)).toEqual(["load", "save", "remove"]);
    expect(commands.every((c) => c.async === undefined)).toBe(true);
  });

  it("valueはproperties（観測）とinputs（設定）の両方に現れる", () => {
    expect(Storage.wcBindable.properties.some((p) => p.name === "value")).toBe(true);
    expect(Storage.wcBindable.inputs!.some((i) => i.name === "value")).toBe(true);
  });

  it("triggerはproperties（観測）とinputs（設定）の両方に現れる", () => {
    expect(Storage.wcBindable.properties.some((p) => p.name === "trigger")).toBe(true);
    expect(Storage.wcBindable.inputs!.some((i) => i.name === "trigger")).toBe(true);
  });

  it("key属性の取得と設定ができる", () => {
    const el = document.createElement("wcs-storage") as Storage;
    expect(el.key).toBe("");
    el.key = "my-key";
    expect(el.key).toBe("my-key");
    expect(el.getAttribute("key")).toBe("my-key");
  });

  it("type属性のデフォルトはlocal", () => {
    const el = document.createElement("wcs-storage") as Storage;
    expect(el.type).toBe("local");
  });

  it("type属性を設定できる", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.type = "session";
    expect(el.type).toBe("session");
  });

  it("manual属性の取得と設定ができる", () => {
    const el = document.createElement("wcs-storage") as Storage;
    expect(el.manual).toBe(false);
    el.manual = true;
    expect(el.manual).toBe(true);
    expect(el.hasAttribute("manual")).toBe(true);
    el.manual = false;
    expect(el.manual).toBe(false);
    expect(el.hasAttribute("manual")).toBe(false);
  });

  it("config.autoTriggerがfalseのときはconnectedCallbackでregisterAutoTriggerを呼ばない", () => {
    setConfig({ autoTrigger: false });
    try {
      const el = document.createElement("wcs-storage") as Storage;
      el.setAttribute("manual", "");
      // autoTrigger=false経路でも例外なく接続できること
      expect(() => document.body.appendChild(el)).not.toThrow();
    } finally {
      setConfig({ autoTrigger: true });
    }
  });

  it("connectedCallbackでkey指定時に自動読み込みされる", () => {
    localStorage.setItem("auto-key", '{"auto":true}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "auto-key");
    document.body.appendChild(el);

    expect(el.value).toEqual({ auto: true });
  });

  it("manual属性がある場合はconnectedCallbackで自動読み込みされない", () => {
    localStorage.setItem("manual-key", '{"manual":true}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "manual-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    expect(el.value).toBeNull();
  });

  it("key未設定時はconnectedCallbackで自動読み込みされない", () => {
    const el = document.createElement("wcs-storage") as Storage;
    document.body.appendChild(el);

    expect(el.value).toBeNull();
  });

  it("接続後にkey属性が変更されると自動読み込みされる", () => {
    localStorage.setItem("changed-key", '{"changed":true}');

    const el = document.createElement("wcs-storage") as Storage;
    document.body.appendChild(el);
    expect(el.value).toBeNull();

    el.setAttribute("key", "changed-key");
    expect(el.value).toEqual({ changed: true });
  });

  it("key属性が空に変更された場合は自動読み込みされない", () => {
    localStorage.setItem("empty-key", '{"data":true}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "empty-key");
    document.body.appendChild(el);
    expect(el.value).toEqual({ data: true });

    el.setAttribute("key", "");
    // valueは前回のまま
    expect(el.value).toEqual({ data: true });
  });

  it("manual属性がある場合はkey変更でも自動読み込みされない", () => {
    localStorage.setItem("manual-change-key", '{"data":true}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    el.setAttribute("key", "manual-change-key");
    expect(el.value).toBeNull();
  });

  it("未接続時のkey変更では自動読み込みされない", () => {
    localStorage.setItem("not-connected-key", '{"data":true}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "not-connected-key");
    // DOM未接続
    expect(el.value).toBeNull();
  });

  it("load()でストレージから読み込みできる", () => {
    localStorage.setItem("load-key", '{"loaded":true}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "load-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const result = el.load();
    expect(result).toEqual({ loaded: true });
    expect(el.value).toEqual({ loaded: true });
  });

  it("save()でストレージに保存できる", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "save-key");
    document.body.appendChild(el);

    // auto-saveモード: valueセッターが自動的にsave()を呼ぶ
    el.value = { saved: true };

    expect(localStorage.getItem("save-key")).toBe('{"saved":true}');
    expect(el.value).toEqual({ saved: true });
  });

  it("remove()でストレージからキーを削除できる", () => {
    localStorage.setItem("remove-key", '{"data":true}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "remove-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    el.load();
    expect(el.value).toEqual({ data: true });

    el.remove();
    expect(localStorage.getItem("remove-key")).toBeNull();
    expect(el.value).toBeNull();
  });

  it("sessionStorageを使用できる", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "session-test");
    el.setAttribute("type", "session");
    document.body.appendChild(el);

    // auto-saveモードでsessionStorageに保存
    el.value = { session: true };
    expect(sessionStorage.getItem("session-test")).toBe('{"session":true}');

    const loaded = el.load();
    expect(loaded).toEqual({ session: true });
  });

  it("valueの設定時にmanualでなければ自動保存される", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "autosave-key");
    document.body.appendChild(el);

    el.value = { autosaved: true };
    expect(localStorage.getItem("autosave-key")).toBe('{"autosaved":true}');
  });

  it("非manualで同一valueを反復代入してもwrite-throughでvalue-changedが毎回再発火する", () => {
    // 指摘1の最終仕様を固定: 主経路（非 manual の value セッター→save()）はライトスルー。
    // 同値代入でも保存され value-changed が毎回発火する（ステージング経路のみ同値ガードを持つ）。
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "echo-key");
    document.body.appendChild(el);

    const events: any[] = [];
    el.addEventListener("wcs-storage:value-changed", (e: Event) => {
      events.push((e as CustomEvent).detail);
    });

    const v = { same: true };
    el.value = v;
    el.value = v; // 同一参照を再代入

    // 2回とも value-changed が発火する（エコー抑止なし）
    expect(events).toHaveLength(2);
    // どちらも保存されている
    expect(localStorage.getItem("echo-key")).toBe('{"same":true}');
  });

  it("valueの設定時にmanualなら自動保存されない", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "no-autosave-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    el.value = { data: true };
    expect(localStorage.getItem("no-autosave-key")).toBeNull();
  });

  it("manualモードでvalue代入は読み取り値を更新する（getter/setter整合）", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "manual-stage-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    el.value = { staged: true };
    // ストレージへは書き込まれないが、読み取り値は代入値に一致する
    expect(el.value).toEqual({ staged: true });
    expect(localStorage.getItem("manual-stage-key")).toBeNull();
  });

  it("manualモードでステージした値をsave()でlocalStorageへコミットできる", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "manual-stage-save-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    el.value = { theme: "dark", lang: "ja" };
    el.save();

    expect(localStorage.getItem("manual-stage-save-key")).toBe('{"theme":"dark","lang":"ja"}');
    expect(el.value).toEqual({ theme: "dark", lang: "ja" });
  });

  it("READMEセクション2: manual + value設定 + triggerでオブジェクト全体が保存される", () => {
    // Quick Start「2. オブジェクトの永続化と $trackDependency」の動作を再現:
    // value: settings でオブジェクトをステージし、trigger: settingsChanged で保存。
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "app-settings");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    // @wcstack/state が value バインド経由で settings オブジェクトを渡す
    el.value = { theme: "dark", lang: "ja" };
    // localStorage にはまだ書き込まれていない（manual + ステージングのみ）
    expect(localStorage.getItem("app-settings")).toBeNull();

    // trigger: settingsChanged が発火 → save() がステージ値をコミット
    el.trigger = true;

    expect(localStorage.getItem("app-settings")).toBe('{"theme":"dark","lang":"ja"}');
    expect(el.trigger).toBe(false);
  });

  it("triggerをtrueに設定するとsave()が実行される", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "trigger-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    // まず値をロード
    localStorage.setItem("trigger-key", '{"original":true}');
    el.load();

    el.trigger = true;
    expect(localStorage.getItem("trigger-key")).toBe('{"original":true}');
    expect(el.trigger).toBe(false);
  });

  it("trigger完了後にfalseにリセットされイベントが発火する", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "trigger-event-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    el.load();

    const events: boolean[] = [];
    el.addEventListener("wcs-storage:trigger-changed", (e: Event) => {
      events.push((e as CustomEvent).detail);
    });

    el.trigger = true;
    expect(el.trigger).toBe(false);
    expect(events).toEqual([false]);
  });

  it("trigger実行時にsave()が失敗してもtriggerはfalseへ復帰しイベントが発火する", () => {
    const el = document.createElement("wcs-storage") as Storage;
    // keyを設定しないのでsave()内のCoreはnever-throwでerrorへ流す（throwしない）
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const events: boolean[] = [];
    el.addEventListener("wcs-storage:trigger-changed", (e: Event) => {
      events.push((e as CustomEvent).detail);
    });

    // never-throw: trigger=true は例外を投げず、save() の失敗は error へ流れる
    expect(() => { el.trigger = true; }).not.toThrow();
    expect(el.error).toEqual({ operation: "save", message: "key is required." });
    // try/finallyによりtriggerはtrueで固着せずfalseへ復帰し、完了イベントも発火する
    expect(el.trigger).toBe(false);
    expect(events).toEqual([false]);
  });

  it("triggerにfalseを設定しても何も起きない", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "no-trigger-key");
    el.setAttribute("manual", "");

    el.trigger = false;
    expect(el.trigger).toBe(false);
  });

  it("loadingプロパティがCoreに委譲される", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("manual", "");
    document.body.appendChild(el);
    expect(el.loading).toBe(false);
  });

  it("errorプロパティがCoreに委譲される", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("manual", "");
    document.body.appendChild(el);
    expect(el.error).toBeNull();
  });

  it("ストレージ例外時にerrorがShellゲッター経由で読み取れる", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "shell-error-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    // manual モードで値をステージしてから save() でコミットさせる
    el.value = { large: "data" };

    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: { setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {}, getItem: () => null },
      configurable: true,
    });

    try {
      el.save();
      // Shell の error ゲッター経由で WcsStorageError が観測できる
      expect(el.error).toEqual({ operation: "save", message: "QuotaExceededError" });
      expect(el.loading).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
    }
  });

  it("loadingのtrue→false遷移がloading-changedイベントでShell境界から観測できる", () => {
    localStorage.setItem("loading-observe-key", '{"data":true}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "loading-observe-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const transitions: boolean[] = [];
    el.addEventListener("wcs-storage:loading-changed", (e: Event) => {
      transitions.push((e as CustomEvent).detail);
    });

    el.load();
    // load() 中に true へ、完了で false へ遷移する
    expect(transitions).toEqual([true, false]);
    expect(el.loading).toBe(false);
  });

  it("manualモードでもconnectedCallbackでCoreのkey/typeが現在値へ同期されcross-tab監視が効く", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "manual-sync-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    // manualではload()が走らないが、startSync前にkeyが同期されているため
    // 他タブからのstorageイベントを受信できる
    const event = new StorageEvent("storage", {
      key: "manual-sync-key",
      newValue: '{"fromOtherTab":true}',
      storageArea: localStorage,
    });
    globalThis.dispatchEvent(event);

    expect(el.value).toEqual({ fromOtherTab: true });
  });

  it("manualモードで接続後にkey変更するとcross-tab監視が新keyを追従する", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "manual-old-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    // 接続後に key を変更（manual なので load() は走らない）
    el.setAttribute("key", "manual-new-key");

    // 旧 key の storage イベントは無視される
    const oldEvent = new StorageEvent("storage", {
      key: "manual-old-key",
      newValue: '{"stale":true}',
      storageArea: localStorage,
    });
    globalThis.dispatchEvent(oldEvent);
    expect(el.value).toBeNull();

    // 新 key の storage イベントは反映される
    const newEvent = new StorageEvent("storage", {
      key: "manual-new-key",
      newValue: '{"fresh":true}',
      storageArea: localStorage,
    });
    globalThis.dispatchEvent(newEvent);
    expect(el.value).toEqual({ fresh: true });
  });

  it("非manualで接続後にkeyを空へ変更するとcross-tab監視も空keyへ追従する", () => {
    localStorage.setItem("clearable-key", '{"data":true}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "clearable-key");
    document.body.appendChild(el);
    expect(el.value).toEqual({ data: true });

    // key を空に変更（load は走らず value は前回のまま）
    el.setAttribute("key", "");
    expect(el.value).toEqual({ data: true });

    // 旧 key の storage イベントはもう反映されない（Core key が空へ同期済み）
    const staleEvent = new StorageEvent("storage", {
      key: "clearable-key",
      newValue: '{"stale":true}',
      storageArea: localStorage,
    });
    globalThis.dispatchEvent(staleEvent);
    expect(el.value).toEqual({ data: true });
  });

  it("再attach時に古いkeyでcross-tab監視が復活しない", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "first-key");
    document.body.appendChild(el);

    // detach
    el.remove();

    // keyを変更して再attach（manualではないがloadは新keyで走る）
    el.setAttribute("key", "second-key");
    document.body.appendChild(el);

    // 古いkeyのstorageイベントは無視される
    const oldEvent = new StorageEvent("storage", {
      key: "first-key",
      newValue: '{"stale":true}',
      storageArea: localStorage,
    });
    globalThis.dispatchEvent(oldEvent);
    expect(el.value).not.toEqual({ stale: true });

    // 新keyのstorageイベントは反映される
    const newEvent = new StorageEvent("storage", {
      key: "second-key",
      newValue: '{"fresh":true}',
      storageArea: localStorage,
    });
    globalThis.dispatchEvent(newEvent);
    expect(el.value).toEqual({ fresh: true });
  });

  it("disconnectedCallbackが呼ばれる", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "disconnect-key");
    document.body.appendChild(el);

    // disconnectedCallbackがエラーなく実行されること
    expect(() => el.remove()).not.toThrow();
  });

  it("type属性の変更でCoreのtypeが更新される", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "type-change-key");
    document.body.appendChild(el);

    el.setAttribute("type", "session");
    expect(el.type).toBe("session");
  });

  it("不正なtype属性はlocalにフォールバックし例外を投げない", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "invalid-type-key");
    document.body.appendChild(el);

    expect(() => el.setAttribute("type", "foo")).not.toThrow();
    expect(el.type).toBe("local");

    // 不正typeでも保存はlocalStorageへ行われる
    el.value = { data: true };
    expect(localStorage.getItem("invalid-type-key")).toBe('{"data":true}');
  });

  it("接続時に不正なtype属性があってもconnectedCallbackが例外を投げない", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "invalid-type-connect-key");
    el.setAttribute("type", "bogus");
    el.setAttribute("manual", "");

    expect(() => document.body.appendChild(el)).not.toThrow();
    expect(el.type).toBe("local");
  });

  it("connectedCallbackPromiseが解決される", async () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    await el.connectedCallbackPromise;
    // エラーなく解決されること
  });

  it("static hasConnectedCallbackPromise が true", () => {
    expect(Storage.hasConnectedCallbackPromise).toBe(true);
  });

  it("イベントがバブルする", () => {
    localStorage.setItem("bubble-key", '{"bubbled":true}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "bubble-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const events: string[] = [];
    document.body.addEventListener("wcs-storage:value-changed", () => events.push("value"));
    document.body.addEventListener("wcs-storage:loading-changed", () => events.push("loading"));

    el.load();
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("autoTrigger", () => {
  beforeEach(() => {
    setConfig({ autoTrigger: true });
    localStorage.clear();
  });

  afterEach(() => {
    unregisterAutoTrigger();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("data-storagetarget属性を持つ要素のクリックでsaveが実行される", () => {
    registerAutoTrigger();

    const el = document.createElement("wcs-storage") as Storage;
    el.id = "my-storage";
    el.setAttribute("key", "auto-trigger-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    // 値を設定してからクリックでsave
    localStorage.setItem("auto-trigger-key", '{"before":true}');
    el.load();

    const button = document.createElement("button");
    button.setAttribute("data-storagetarget", "my-storage");
    document.body.appendChild(button);

    button.click();

    expect(localStorage.getItem("auto-trigger-key")).toBe('{"before":true}');
  });

  it("対象のidの要素がwcs-storageでない場合は何もしない", () => {
    registerAutoTrigger();

    const div = document.createElement("div");
    div.id = "not-a-storage";
    document.body.appendChild(div);

    const button = document.createElement("button");
    button.setAttribute("data-storagetarget", "not-a-storage");
    document.body.appendChild(button);

    expect(() => button.click()).not.toThrow();
  });

  it("対象のwcs-storage要素が存在しない場合は何もしない", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    button.setAttribute("data-storagetarget", "nonexistent");
    document.body.appendChild(button);

    expect(() => button.click()).not.toThrow();
  });

  it("event.targetがElement以外の場合は何もしない", () => {
    registerAutoTrigger();

    const event = new Event("click", { bubbles: true });
    Object.defineProperty(event, "target", { value: null });

    expect(() => document.dispatchEvent(event)).not.toThrow();
  });

  it("data-storagetarget属性がない要素のクリックでは何もしない", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    document.body.appendChild(button);

    expect(() => button.click()).not.toThrow();
  });

  it("registerAutoTriggerを2回呼んでも二重登録されない", () => {
    registerAutoTrigger();
    registerAutoTrigger();

    // エラーにならないことを確認
    const button = document.createElement("button");
    button.setAttribute("data-storagetarget", "nonexistent");
    document.body.appendChild(button);

    expect(() => button.click()).not.toThrow();
  });

  it("unregisterAutoTrigger後はイベントが発火しない", () => {
    registerAutoTrigger();
    unregisterAutoTrigger();
    setConfig({ autoTrigger: false });

    // エラーにならないことを確認
    const button = document.createElement("button");
    button.setAttribute("data-storagetarget", "nonexistent");
    document.body.appendChild(button);

    expect(() => button.click()).not.toThrow();
  });

  it("unregisterAutoTriggerを未登録時に呼んでもエラーにならない", () => {
    expect(() => unregisterAutoTrigger()).not.toThrow();
  });

  it("data-storagetarget属性の値が空の場合は何もしない", () => {
    registerAutoTrigger();

    const button = document.createElement("button");
    button.setAttribute("data-storagetarget", "");
    document.body.appendChild(button);

    expect(() => button.click()).not.toThrow();
  });

  it("子要素のクリックでも親のdata-storagetargetを検出する", () => {
    registerAutoTrigger();

    const el = document.createElement("wcs-storage") as Storage;
    el.id = "my-storage";
    el.setAttribute("key", "child-click-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    localStorage.setItem("child-click-key", '{"test":true}');
    el.load();

    const button = document.createElement("button");
    button.setAttribute("data-storagetarget", "my-storage");
    const span = document.createElement("span");
    span.textContent = "Click me";
    button.appendChild(span);
    document.body.appendChild(button);

    span.click();

    expect(localStorage.getItem("child-click-key")).toBe('{"test":true}');
  });
});

describe("bootstrapStorage", () => {
  afterEach(() => {
    unregisterAutoTrigger();
    setConfig({ autoTrigger: true });
  });

  it("コンポーネントが登録される", () => {
    expect(customElements.get("wcs-storage")).toBeDefined();
  });

  it("設定なしでブートストラップできる", () => {
    bootstrapStorage();
    expect(config.autoTrigger).toBe(true);
  });

  it("autoTrigger=falseでブートストラップできる", () => {
    bootstrapStorage({ autoTrigger: false });
    expect(config.autoTrigger).toBe(false);
  });
});

describe("registerComponents", () => {
  it("既に登録済みの場合は再登録しない", () => {
    expect(() => registerComponents()).not.toThrow();
  });
});

describe("connectedCallbackPromise プロトコル", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("static hasConnectedCallbackPromise が true", () => {
    expect(Storage.hasConnectedCallbackPromise).toBe(true);
  });

  it("connectedCallbackPromise が解決済み Promise を返す", async () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    const result = await el.connectedCallbackPromise;
    expect(result).toBeUndefined();
  });

  it("auto-load 時に connectedCallbackPromise が解決される", async () => {
    localStorage.setItem("promise-key", '{"data":"test"}');

    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "promise-key");
    document.body.appendChild(el);

    await el.connectedCallbackPromise;
    expect(el.value).toEqual({ data: "test" });
  });
});
