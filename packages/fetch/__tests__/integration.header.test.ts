import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady } from "@wcstack/state";
import { registerComponents } from "../src/registerComponents";
import { FetchHeader } from "../src/components/FetchHeader";

/**
 * `<wcs-fetch-header>` の値を実 @wcstack/state から束ねる（docs/seam-apps.md、router-auth）。
 *
 * 以前の要素は属性しか読まず、`value` プロパティを持たなかった。`data-wcs="value: authHeader"` は
 * 要素が読まない expando を書くだけで、要求は空の `Authorization` で出ていた（エラーも lint も無し）。
 * 今は `name` / `value` が属性へ反映するプロパティで、`value` 属性が無いヘッダーは送らない。
 */

function createMockResponse(body: any): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve));
};

beforeAll(() => {
  bootstrapState();
  registerComponents();
});

let fetchSpy: ReturnType<typeof vi.spyOn>;
let host: HTMLElement | null = null;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  fetchSpy.mockResolvedValue(createMockResponse({ ok: true }));
});

afterEach(() => {
  host?.remove();
  host = null;
  fetchSpy.mockRestore();
});

/** 送った要求の Authorization（無ければ undefined）。 */
const sentAuth = (): Array<string | undefined> =>
  fetchSpy.mock.calls.map(([, init]: any) => (init?.headers as Record<string, string> | undefined)?.Authorization);

async function mount(state: object): Promise<{ host: HTMLElement; stateEl: any }> {
  const el = document.createElement("div");
  el.innerHTML = `
    <wcs-fetch url="/api/me" manual data-wcs="trigger: load">
      <wcs-fetch-header name="Authorization" data-wcs="value: authHeader"></wcs-fetch-header>
    </wcs-fetch>
    <wcs-state></wcs-state>
  `;
  document.body.appendChild(el);
  const stateEl = el.querySelector("wcs-state") as any;
  stateEl.setInitialState(state);
  await stateEl.connectedCallbackPromise;
  await getBindingsReady(document);
  return { host: el, stateEl };
}

describe("integration: <wcs-fetch-header> の value を state から束ねる", () => {
  it("value: で束ねたトークンがヘッダーで届き、null の間はヘッダーを送らない", async () => {
    const m = await mount({
      token: null as string | null,
      load: false,
      get authHeader() { return this.token === null ? null : `Bearer ${this.token}`; },
    });
    host = m.host;
    const write = async (fn: (s: any) => void) => {
      m.stateEl.createState("writable", fn);
      await settle();
    };

    await write((s) => { s.load = true; });
    await write((s) => { s.token = "t1"; });
    await write((s) => { s.load = true; });
    await write((s) => { s.token = null; });
    await write((s) => { s.load = true; });

    expect(sentAuth()).toEqual([undefined, "Bearer t1", undefined]);
  });
});

describe("FetchHeader のプロパティ", () => {
  it("name / value は属性へ反映する。null は属性を外し、undefined はマークアップの値に戻す", () => {
    const el = document.createElement("wcs-fetch-header") as FetchHeader;
    el.setAttribute("value", "markup");
    el.value = "Bearer x";
    expect(el.getAttribute("value")).toBe("Bearer x");
    expect(el.headerValue).toBe("Bearer x");
    el.value = null;
    expect(el.hasAttribute("value")).toBe(false);
    expect(el.hasHeader).toBe(false);
    el.value = undefined;
    expect(el.getAttribute("value")).toBe("markup");
    el.name = "X-Id";
    expect(el.getAttribute("name")).toBe("X-Id");
    expect(el.headerName).toBe("X-Id");
  });

  it("名前と value 属性（空でも）があるときだけ送る", () => {
    const el = document.createElement("wcs-fetch-header") as FetchHeader;
    expect(el.hasHeader).toBe(false);
    el.setAttribute("value", "");
    expect(el.hasHeader).toBe(false);
    el.setAttribute("name", "X-Empty");
    expect(el.hasHeader).toBe(true);
  });

  it("upgrade 前に代入した value も、接続時に setter を通る", () => {
    const el = document.createElement("wcs-fetch-header") as FetchHeader;
    // upgrade 前の framework の代入を再現（accessor を own データプロパティが隠している状態）
    Object.defineProperty(el, "value", { value: "early", writable: true, configurable: true, enumerable: true });
    expect(el.hasAttribute("value")).toBe(false);
    document.body.appendChild(el);
    expect(el.getAttribute("value")).toBe("early");
    el.remove();
  });

});
