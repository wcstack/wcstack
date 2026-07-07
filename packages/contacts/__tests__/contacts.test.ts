import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapContacts } from "../src/bootstrapContacts";
import { setConfig } from "../src/config";
import { WcsContacts } from "../src/components/Contacts";
import { installSelect, removeContacts } from "./mocks";

function createContacts(): WcsContacts {
  return document.createElement("wcs-contacts") as WcsContacts;
}

describe("Contacts (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { contacts: "wcs-contacts" } });
    bootstrapContacts();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    removeContacts();
  });

  it("接続時に display:none になる", () => {
    const el = createContacts();
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createContacts();
    expect(el.value).toBeNull();
    expect(el.loading).toBe(false);
    expect(el.error).toBeNull();
    expect(el.cancelled).toBe(false);
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    expect(WcsContacts.hasConnectedCallbackPromise).toBe(true);
    const el = createContacts();
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
  });

  it("disconnectedCallback で dispose される（以後の stale resolve が状態を変えない）", async () => {
    let resolveSelect!: (contacts: any[]) => void;
    installSelect(() => new Promise<any[]>((resolve) => { resolveSelect = resolve; }));
    const el = createContacts();
    document.body.appendChild(el);

    const promise = el.select(["name"]);
    el.remove(); // disconnectedCallback → dispose()
    resolveSelect([{ name: ["Taro"] }]);

    await promise;
    expect(el.value).toBeNull();
  });

  it("select() が成功すると value/loading が反映される", async () => {
    const contacts = [{ name: ["Taro Yamada"] }];
    installSelect(() => Promise.resolve(contacts));
    const el = createContacts();
    document.body.appendChild(el);

    const result = await el.select(["name"], { multiple: true });

    expect(result).toEqual(contacts);
    expect(el.value).toEqual(contacts);
    expect(el.loading).toBe(false);
  });

  it("select() が AbortError で拒否されると cancelled が true になる", async () => {
    installSelect(() => Promise.reject(new DOMException("Picker canceled", "AbortError")));
    const el = createContacts();
    document.body.appendChild(el);

    await el.select(["name"]);

    expect(el.cancelled).toBe(true);
    expect(el.error).toBeNull();
  });

  it("select() がそれ以外の例外で拒否されると error が設定される", async () => {
    installSelect(() => Promise.reject(new DOMException("boom", "NotAllowedError")));
    const el = createContacts();
    document.body.appendChild(el);

    await el.select(["name"]);

    expect(el.error).not.toBeNull();
    expect(el.cancelled).toBe(false);
  });

  it("navigator.contacts 不在時は error になる（unsupported、Android Chrome 以外の既定状態）", async () => {
    removeContacts();
    const el = createContacts();
    document.body.appendChild(el);

    const result = await el.select(["name"]);

    expect(result).toBeNull();
    expect(el.error).toEqual({ message: "Contact Picker API is not supported in this browser." });
  });

  it("wcBindable: inputs は空、commands は select(async) のみ、properties は Core を継承する", () => {
    expect(WcsContacts.wcBindable.inputs).toEqual([]);
    expect(WcsContacts.wcBindable.commands).toEqual([{ name: "select", async: true }]);
    expect(WcsContacts.wcBindable.properties.map((p) => p.name)).toEqual([
      "value", "loading", "error", "cancelled",
    ]);
  });

  it("再接続すると再度 observe() され、以後の select() が独立して動く", async () => {
    installSelect(() => Promise.resolve([{ name: ["Taro"] }]));
    const el = createContacts();
    document.body.appendChild(el);
    el.remove();
    document.body.appendChild(el);

    const result = await el.select(["name"]);
    expect(result).toEqual([{ name: ["Taro"] }]);
  });
});
