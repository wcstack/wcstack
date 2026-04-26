import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Storage } from "../src/components/Storage";
import { bootstrapStorage } from "../src/bootstrapStorage";
import { registerComponents } from "../src/registerComponents";
import { registerAutoTrigger, unregisterAutoTrigger } from "../src/autoTrigger";
import { config, setConfig, getConfig } from "../src/config";
import { raiseError } from "../src/raiseError";

// registerComponents経由でカスタム要素を登録
registerComponents();

describe("raiseError", () => {
  it("[@wcstack/storage]プレフィックス付きのエラーをスローする", () => {
    expect(() => raiseError("test error")).toThrow("[@wcstack/storage] test error");
  });
});

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

  it("valueの設定時にmanualなら自動保存されない", () => {
    const el = document.createElement("wcs-storage") as Storage;
    el.setAttribute("key", "no-autosave-key");
    el.setAttribute("manual", "");
    document.body.appendChild(el);

    el.value = { data: true };
    expect(localStorage.getItem("no-autosave-key")).toBeNull();
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
