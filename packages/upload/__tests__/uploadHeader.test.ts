import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapUpload } from "../src/bootstrapUpload";
import { registerComponents } from "../src/registerComponents";
import { getConfig, setConfig } from "../src/config";
import { WcsUpload } from "../src/components/Upload";
import { WcsUploadHeader } from "../src/components/UploadHeader";
import * as api from "../src/exports";
import { MockXMLHttpRequest, createMockFile } from "./helpers/mockXhr";

/**
 * `<wcs-upload-header name value>`（docs/seam-apps.md、family-ledger）。
 *
 * 以前の `<wcs-upload>` はヘッダーを 1 つも送れなかった。Shell は `method` と `fieldName` だけを Core に
 * 渡しており、毎回 `Authorization: Bearer …` を求める API には `UploadCore` を直に使うしかなかった。
 * 今は `<wcs-fetch-header>` と同じ形の子要素で、アップロードを始めるときに読んで `headers` として渡す。
 */

let originalXHR: typeof XMLHttpRequest;

beforeEach(() => {
  originalXHR = globalThis.XMLHttpRequest;
  (globalThis as any).XMLHttpRequest = MockXMLHttpRequest;
  MockXMLHttpRequest.resetInstances();
  setConfig({ autoTrigger: false });
  bootstrapUpload();
});

afterEach(() => {
  setConfig({ autoTrigger: true, tagNames: { upload: "wcs-upload", uploadHeader: "wcs-upload-header" } });
  globalThis.XMLHttpRequest = originalXHR;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function mount(inner: string, attrs: Record<string, string> = {}): WcsUpload {
  const el = document.createElement("wcs-upload") as WcsUpload;
  el.setAttribute("url", "/api/receipts");
  el.setAttribute("manual", "");
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

/** アップロードを 1 回始めて、その XHR が受けた setRequestHeader を [名前, 値] で返す。 */
function send(el: WcsUpload): Array<[string, string]> {
  const before = MockXMLHttpRequest.instances.length;
  el.files = [createMockFile("receipt.png", 10, "image/png")];
  void el.upload();
  expect(MockXMLHttpRequest.instances).toHaveLength(before + 1);
  const xhr = MockXMLHttpRequest.instances[before];
  const calls = xhr.setRequestHeader.mock.calls as Array<[string, string]>;
  xhr.simulateLoad(200, "{}", "application/json");
  return calls;
}

describe("WcsUploadHeader の登録", () => {
  it("bootstrapUpload で wcs-upload-header が WcsUploadHeader として定義される", () => {
    expect(customElements.get("wcs-upload-header")).toBe(WcsUploadHeader);
  });

  it("WcsUploadHeader をパッケージから出す（タグを自分で定義するページが補助のタグも定義できる）", () => {
    expect(api.WcsUploadHeader).toBe(WcsUploadHeader);
  });

  it("既定のタグ名は wcs-upload-header で、tagNames.uploadHeader で変えられる", () => {
    expect(getConfig().tagNames.uploadHeader).toBe("wcs-upload-header");
    setConfig({ tagNames: { uploadHeader: "my-upload-header" } });
    expect(getConfig().tagNames.uploadHeader).toBe("my-upload-header");
    // 知らないタグ名のキーは今も投げる
    expect(() => setConfig({ tagNames: { uploadHeaders: "x-h" } } as any)).toThrow(
      `[@wcstack/upload] bootstrapUpload: "tagNames.uploadHeaders" is not one of its options, or not of the option's type.`,
    );
  });

  it("registerComponents は設定したタグ名でヘッダーのタグを定義する", () => {
    setConfig({ tagNames: { upload: "my-upload", uploadHeader: "my-upload-header" } });
    const defined = new Map<string, CustomElementConstructor>();
    const registry = {
      get: (name: string) => defined.get(name),
      define: (name: string, ctor: CustomElementConstructor) => { defined.set(name, ctor); },
    } as unknown as CustomElementRegistry;
    registerComponents(registry);
    expect(defined.get("my-upload")).toBe(WcsUpload);
    expect(defined.get("my-upload-header")).toBe(WcsUploadHeader);
    // 定義済みなら定義し直さない
    registerComponents(registry);
    expect(defined.size).toBe(2);
  });
});

describe("WcsUploadHeader のプロパティ", () => {
  it("name / value は属性へ反映する。null は属性を外し、undefined はマークアップの値に戻す", () => {
    const el = document.createElement("wcs-upload-header") as WcsUploadHeader;
    el.setAttribute("value", "markup");
    el.value = "Bearer x";
    expect(el.getAttribute("value")).toBe("Bearer x");
    expect(el.value).toBe("Bearer x");
    el.value = null;
    expect(el.hasAttribute("value")).toBe(false);
    expect(el.value).toBe("");
    el.value = undefined;
    expect(el.getAttribute("value")).toBe("markup");
    el.name = "X-Id";
    expect(el.getAttribute("name")).toBe("X-Id");
    expect(el.name).toBe("X-Id");
    el.name = null;
    expect(el.hasAttribute("name")).toBe(false);
    expect(el.name).toBe("");
  });

  it("名前と value 属性（空でも）があるときだけ送る", () => {
    const el = document.createElement("wcs-upload-header") as WcsUploadHeader;
    expect(el.hasHeader).toBe(false);
    el.setAttribute("value", "");
    expect(el.hasHeader).toBe(false);
    el.setAttribute("name", "X-Empty");
    expect(el.hasHeader).toBe(true);
    el.removeAttribute("value");
    expect(el.hasHeader).toBe(false);
  });

  it("upgrade 前に代入した name / value も、接続時に setter を通る", () => {
    const el = document.createElement("wcs-upload-header") as WcsUploadHeader;
    // upgrade 前の framework の代入を再現（accessor を own データプロパティが隠している状態）
    Object.defineProperty(el, "name", { value: "Authorization", writable: true, configurable: true, enumerable: true });
    Object.defineProperty(el, "value", { value: "early", writable: true, configurable: true, enumerable: true });
    expect(el.hasAttribute("value")).toBe(false);
    document.body.appendChild(el);
    expect(el.getAttribute("name")).toBe("Authorization");
    expect(el.getAttribute("value")).toBe("early");
    expect(Object.prototype.hasOwnProperty.call(el, "value")).toBe(false);
    expect(el.hasHeader).toBe(true);
  });

  it("接続すると表示しない", () => {
    const el = document.createElement("wcs-upload-header") as WcsUploadHeader;
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");
  });

  it("wcBindable を宣言しない（<wcs-upload> のマークアップの一部で、I/O ノードではない）", () => {
    expect((WcsUploadHeader as any).wcBindable).toBeUndefined();
  });
});

describe("<wcs-upload> が <wcs-upload-header> を送る", () => {
  it("中のヘッダーをすべて要求ヘッダーとして送る", () => {
    const el = mount(`
      <wcs-upload-header name="Authorization" value="Bearer t1"></wcs-upload-header>
      <wcs-upload-header name="X-Ledger" value="household"></wcs-upload-header>
    `);
    expect(send(el)).toEqual([["Authorization", "Bearer t1"], ["X-Ledger", "household"]]);
  });

  it("value 属性の無いヘッダーと名前の無いヘッダーは送らず、空の value=\"\" は送る", () => {
    const el = mount(`
      <wcs-upload-header name="Authorization"></wcs-upload-header>
      <wcs-upload-header value="orphan"></wcs-upload-header>
      <wcs-upload-header name="X-Empty" value=""></wcs-upload-header>
    `);
    expect(send(el)).toEqual([["X-Empty", ""]]);
  });

  it("ヘッダーが無ければ何も付けない", () => {
    const el = mount("");
    expect(send(el)).toEqual([]);
  });

  it("接続したときではなく、アップロードを始めるときに読む", () => {
    const el = mount(`<wcs-upload-header name="Authorization"></wcs-upload-header>`);
    const header = el.querySelector("wcs-upload-header") as WcsUploadHeader;
    expect(send(el)).toEqual([]);
    header.value = "Bearer t1";
    expect(send(el)).toEqual([["Authorization", "Bearer t1"]]);
    // 接続した後に足したヘッダーも送る
    const added = document.createElement("wcs-upload-header") as WcsUploadHeader;
    added.name = "X-Added";
    added.value = "1";
    el.appendChild(added);
    expect(send(el)).toEqual([["Authorization", "Bearer t1"], ["X-Added", "1"]]);
    // null に戻すとまた送らない
    header.value = null;
    expect(send(el)).toEqual([["X-Added", "1"]]);
  });

  it("自動送信（files の代入）でもヘッダーを送り、method / field-name と並べて渡す", () => {
    const el = document.createElement("wcs-upload") as WcsUpload;
    el.setAttribute("url", "/api/receipts");
    el.setAttribute("method", "PUT");
    el.setAttribute("field-name", "receipt");
    el.innerHTML = `<wcs-upload-header name="Authorization" value="Bearer t1"></wcs-upload-header>`;
    document.body.appendChild(el);
    el.files = [createMockFile("receipt.png", 10, "image/png")];
    const xhr = MockXMLHttpRequest.instances[0];
    expect(xhr.open).toHaveBeenCalledWith("PUT", "/api/receipts");
    expect(xhr.setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer t1");
    expect((xhr.send.mock.calls[0][0] as FormData).getAll("receipt")).toHaveLength(1);
  });

  it("拒んだアップロード（url が無い・検証に落ちた）ではヘッダーを読まない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setConfig({ tagNames: { uploadHeader: "x-undefined-header" } });
    const el = mount(`<x-undefined-header name="Authorization" value="Bearer t"></x-undefined-header>`, { "max-size": "1" });
    el.files = [createMockFile("big.png", 10, "image/png")];
    void el.upload();
    el.url = null;
    el.maxSize = null;
    el.files = [createMockFile("small.png", 1, "image/png")];
    void el.upload();
    expect(MockXMLHttpRequest.instances).toHaveLength(0);
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes("[wcs/command-not-ready]"))).toBe(true);
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes("[wcs/upload-helper-undefined]"))).toBe(false);
  });

  it("Content-Type のヘッダーは送るが、multipart の境界を落とすので警告する", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = mount(`<wcs-upload-header name="content-type" value="multipart/form-data"></wcs-upload-header>`);
    expect(send(el)).toEqual([["content-type", "multipart/form-data"]]);
    const said = warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("A Content-Type header was set on an upload"));
    expect(said).toHaveLength(1);
    expect(String(said[0][0])).toContain("remove the Content-Type <wcs-upload-header>");
    expect(said[0][1]).toBe(el);
  });

  it("Content-Type 以外のヘッダーでは警告しない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = mount(`<wcs-upload-header name="Authorization" value="Bearer t1"></wcs-upload-header>`);
    send(el);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("定義されていない補助のタグ（[wcs/upload-helper-undefined]）", () => {
  const said = (warn: ReturnType<typeof vi.spyOn>): unknown[][] =>
    warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("[wcs/upload-helper-undefined]"));

  it("定義の無いヘッダーのタグは送らず、要素ごとに 1 回だけ言う", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setConfig({ tagNames: { uploadHeader: "x-undefined-header" } });
    const el = mount(`<x-undefined-header name="Authorization" value="Bearer t"></x-undefined-header>`);
    expect(send(el)).toEqual([]);
    expect(send(el)).toEqual([]);
    expect(said(warn)).toHaveLength(1);
    expect(String(said(warn)[0][0])).toContain(
      "<x-undefined-header> inside this <wcs-upload> is not defined, so its header is not sent",
    );
    expect(String(said(warn)[0][0])).toContain("define WcsUploadHeader with WcsUpload");
    expect(said(warn)[0][1]).toBe(el);
    // 別の要素ではまた言う
    const other = mount(`<x-undefined-header name="Authorization" value="Bearer t"></x-undefined-header>`);
    send(other);
    expect(said(warn)).toHaveLength(2);
    expect(said(warn)[1][1]).toBe(other);
  });

  it("定義されたタグでは言わない", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = mount(`<wcs-upload-header name="X-A" value="1"></wcs-upload-header>`);
    expect(send(el)).toEqual([["X-A", "1"]]);
    expect(said(warn)).toHaveLength(0);
  });
});
