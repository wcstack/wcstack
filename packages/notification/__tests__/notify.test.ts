import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WcsNotify } from "../src/components/Notify.js";
import { setConfig } from "../src/config.js";
import { unregisterAutoTrigger } from "../src/autoTrigger.js";
import {
  FakeNotification, installNotification, removeNotification,
  removePermissions, flush,
} from "./mocks.js";

if (!customElements.get("wcs-notify")) {
  customElements.define("wcs-notify", WcsNotify);
}

let el: WcsNotify;

async function mount(attrs: Record<string, string> = {}): Promise<WcsNotify> {
  el = document.createElement("wcs-notify") as WcsNotify;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  await el.connectedCallbackPromise;
  return el;
}

beforeEach(() => {
  installNotification({ permission: "granted" });
  removePermissions();
});

afterEach(() => {
  el?.remove();
  removeNotification();
  removePermissions();
  unregisterAutoTrigger();
  setConfig({ autoTrigger: true, triggerAttribute: "data-notifytarget" });
});

describe("ライフサイクルと委譲", () => {
  it("自身を非表示にし、permission を監視し、getter を Core に委譲する", async () => {
    await mount();
    expect(el.style.display).toBe("none");
    expect(el.granted).toBe(true);
    expect(el.permission).toBe("granted");
    expect(el.denied).toBe(false);
    expect(el.prompt).toBe(false);
    expect(el.unsupported).toBe(false);
    expect(el.error).toBeNull();
    expect(el.clicked).toBeNull();
    expect(el.closed).toBeNull();
    expect(el.shown).toBeNull();
  });

  it("request() を委譲する", async () => {
    removeNotification();
    installNotification({ permission: "default" });
    await mount();
    FakeNotification.requestResult = "granted";
    expect(await el.request()).toBe("granted");
    expect(el.granted).toBe(true);
  });

  it("close() と closeAll() を委譲する", async () => {
    await mount();
    el.notify("A", { tag: "a" });
    el.notify("B", { tag: "b" });
    const [a, b] = FakeNotification.instances;
    el.close("a");
    expect(a.closed).toBe(true);
    el.closeAll();
    expect(b.closed).toBe(true);
  });

  it("autoTrigger 無効時は click ショートカットを登録しない", async () => {
    setConfig({ autoTrigger: false });
    await mount();
    // No assertion beyond not throwing: the false branch of connectedCallback is
    // exercised. A document click does nothing because no listener was registered.
    document.body.click();
    expect(el.granted).toBe(true);
  });
});

describe("mode 属性", () => {
  it("既定は auto で、sw / constructor を受け付ける", async () => {
    await mount();
    expect(el.mode).toBe("auto");
    el.mode = "sw";
    expect(el.getAttribute("mode")).toBe("sw");
    expect(el.mode).toBe("sw");
    el.setAttribute("mode", "constructor");
    expect(el.mode).toBe("constructor");
    el.setAttribute("mode", "garbage");
    expect(el.mode).toBe("auto");
  });
});

describe("reactive な `notice`", () => {
  it("値が変われば表示し、同値の書き込みは抑止する", async () => {
    await mount();
    el.notice = "first";
    expect(FakeNotification.instances).toHaveLength(1);
    el.notice = "first";
    expect(FakeNotification.instances).toHaveLength(1);
    el.notice = "second";
    expect(FakeNotification.instances).toHaveLength(2);
    expect(el.notice).toBe("second");
  });

  it("null/undefined の書き込みは無視する", async () => {
    await mount();
    el.notice = null;
    el.notice = undefined as unknown as string;
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("`manual` 属性でミュートされる（command は引き続き動作する）", async () => {
    await mount({ manual: "" });
    el.notice = "x";
    expect(FakeNotification.instances).toHaveLength(0);
    el.notify("x");
    expect(FakeNotification.instances).toHaveLength(1);
  });
});

describe("オプション属性", () => {
  it("notify() 向けに属性から options を組み立てる", async () => {
    await mount({
      body: "B", icon: "I", badge: "G", tag: "T", lang: "en", dir: "rtl",
      "require-interaction": "", silent: "", renotify: "",
    });
    el.notify("Title");
    const o = FakeNotification.instances[0].options;
    expect(o).toMatchObject({
      body: "B", icon: "I", badge: "G", tag: "T", lang: "en", dir: "rtl",
      requireInteraction: true, silent: true, renotify: true,
    });
  });

  it("不正な dir と空の options を除外する", async () => {
    await mount({ dir: "sideways" });
    el.notify("Title");
    const o = FakeNotification.instances[0].options;
    expect(o.dir).toBeUndefined();
    expect(o.body).toBeUndefined();
  });

  it("明示的な notify() の options が属性デフォルトにキー単位で優先する", async () => {
    await mount({ body: "attr-body", icon: "attr-icon" });
    el.notify("Title", { body: "explicit-body" });
    const o = FakeNotification.instances[0].options;
    expect(o.body).toBe("explicit-body");
    expect(o.icon).toBe("attr-icon");
  });
});

describe("属性アクセサが HTML と相互に反映する", () => {
  it("文字列 setter は属性へ反映し、null で削除する", async () => {
    await mount();
    el.body = "b"; expect(el.getAttribute("body")).toBe("b");
    el.body = null; expect(el.hasAttribute("body")).toBe(false);
    el.icon = "i"; expect(el.icon).toBe("i");
    el.icon = null; expect(el.icon).toBe("");
    el.badge = "g"; expect(el.badge).toBe("g");
    el.badge = null; expect(el.badge).toBe("");
    el.tag = "t"; expect(el.tag).toBe("t");
    el.tag = null; expect(el.tag).toBe("");
    el.lang = "en"; expect(el.lang).toBe("en");
    el.lang = null; expect(el.lang).toBe("");
    el.dir = "ltr"; expect(el.dir).toBe("ltr");
    el.dir = null; expect(el.dir).toBe("");
  });

  it("boolean setter は反映・削除する", async () => {
    await mount();
    el.requireInteraction = true; expect(el.hasAttribute("require-interaction")).toBe(true);
    el.requireInteraction = false; expect(el.requireInteraction).toBe(false);
    el.silent = true; expect(el.silent).toBe(true);
    el.silent = false; expect(el.silent).toBe(false);
    el.renotify = true; expect(el.renotify).toBe(true);
    el.renotify = false; expect(el.renotify).toBe(false);
    el.manual = true; expect(el.manual).toBe(true);
    el.manual = false; expect(el.manual).toBe(false);
  });
});

describe("委譲された event-token getter", () => {
  it("click を Shell の getter まで反映する", async () => {
    await mount();
    el.notify("Hi", { tag: "t", data: { n: 1 } });
    FakeNotification.instances[0].fireClick();
    expect(el.clicked).toEqual({ tag: "t", data: { n: 1 }, action: "" });
  });
});

describe("SSR の connectedCallbackPromise", () => {
  it("接続時の probe が確定したら resolve する", async () => {
    el = document.createElement("wcs-notify") as WcsNotify;
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    await flush();
  });
});
