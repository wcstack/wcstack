import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { bootstrapState, getBindingsReady } from "@wcstack/state";
import { setConfig } from "../src/config";
import { registerComponents } from "../src/registerComponents";
import type { WcsUpload } from "../src/components/Upload";
import { MockXMLHttpRequest, createMockFile } from "./helpers/mockXhr";

/**
 * `<wcs-upload-header>` の値を実 @wcstack/state から束ねる（docs/seam-apps.md、family-ledger）。
 *
 * 家計簿のアプリは、毎回 `Authorization: Bearer <token>` を求める API にレシートを送る必要があった。
 * `<wcs-upload>` はヘッダーを送れず、作者は CDN から `UploadCore` を読み込んで直に使った。今は
 * `<wcs-fetch-header>` と同じく `data-wcs="value: authHeader"` で束ね、トークンの無い間（getter が
 * `null`）は `Authorization` を送らない。
 */

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve));
};

let originalXHR: typeof XMLHttpRequest;
let host: HTMLElement | null = null;

beforeAll(() => {
  setConfig({ autoTrigger: false });
  bootstrapState();
  registerComponents();
});

beforeEach(() => {
  originalXHR = globalThis.XMLHttpRequest;
  (globalThis as any).XMLHttpRequest = MockXMLHttpRequest;
  MockXMLHttpRequest.resetInstances();
});

afterEach(() => {
  host?.remove();
  host = null;
  globalThis.XMLHttpRequest = originalXHR;
});

/** 送った各アップロードの Authorization（無ければ undefined）。 */
const sentAuth = (): Array<string | undefined> =>
  MockXMLHttpRequest.instances.map(
    (xhr) => (xhr.setRequestHeader.mock.calls as Array<[string, string]>).find(([name]) => name === "Authorization")?.[1],
  );

async function mount(state: object): Promise<{ host: HTMLElement; stateEl: any; upload: WcsUpload }> {
  const el = document.createElement("div");
  el.innerHTML = `
    <wcs-upload url="/api/receipts" manual>
      <wcs-upload-header name="Authorization" data-wcs="value: authHeader"></wcs-upload-header>
    </wcs-upload>
    <wcs-state></wcs-state>
  `;
  document.body.appendChild(el);
  const stateEl = el.querySelector("wcs-state") as any;
  stateEl.setInitialState(state);
  await stateEl.connectedCallbackPromise;
  await getBindingsReady(document);
  return { host: el, stateEl, upload: el.querySelector("wcs-upload") as WcsUpload };
}

describe("integration: <wcs-upload-header> の value を state から束ねる", () => {
  it("value: で束ねたトークンがヘッダーで届き、null の間はヘッダーを送らない", async () => {
    const m = await mount({
      token: null as string | null,
      get authHeader() { return this.token === null ? null : `Bearer ${this.token}`; },
    });
    host = m.host;
    const write = async (fn: (s: any) => void) => {
      m.stateEl.createState("writable", fn);
      await settle();
    };
    const upload = () => {
      m.upload.files = [createMockFile("receipt.png", 10, "image/png")];
      void m.upload.upload();
      MockXMLHttpRequest.instances.at(-1)!.simulateLoad(200, "{}", "application/json");
    };

    upload();
    await write((s) => { s.token = "t1"; });
    upload();
    await write((s) => { s.token = null; });
    upload();

    expect(sentAuth()).toEqual([undefined, "Bearer t1", undefined]);
  });
});
