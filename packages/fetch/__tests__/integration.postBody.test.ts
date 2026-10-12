import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady } from "@wcstack/state";
import { registerComponents } from "../src/registerComponents";

/**
 * README「4. POST with a body」を実 @wcstack/state で固定する。
 *
 * `body` は使い捨ての入力で、`<wcs-fetch>` は要求のたびに `null` へ戻す（Design Notes）。
 * フォームのオブジェクトそのものを束ねた旧い例（`body: newUser`）は、入力欄が束ねたパスの
 * *下*（`newUser.name`）へ書くので束縛が当て直されず、2 回目の送信が本文なしになっていた。
 * README の形 — 送信のハンドラで毎回新しいオブジェクトを作って `submitBody` に代入する —
 * なら、入力を変えない再送信も含めて毎回本文が届く。両方をここで固定する。
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

const README_STATE = () => ({
  newUser: { name: "", email: "" },
  submitBody: null as any,
  submitRequest: false,
  submitResult: null as any,
  submitError: null as any,
  submitLoading: false,
  submit(this: any) {
    this.submitBody = { name: this["newUser.name"], email: this["newUser.email"] };
    this.submitRequest = true;
  },
});

const OLD_STATE = () => ({
  newUser: { name: "", email: "" },
  submitRequest: false,
  submitResult: null as any,
  submit(this: any) {
    this.submitRequest = true;
  },
});

async function mount(state: object, bodyPath: string): Promise<{ host: HTMLElement; name: HTMLInputElement; email: HTMLInputElement; button: HTMLButtonElement }> {
  const host = document.createElement("div");
  host.innerHTML = `
    <input class="name" data-wcs="value: newUser.name">
    <input class="email" data-wcs="value: newUser.email">
    <button data-wcs="onclick: submit">Create</button>
    <wcs-fetch url="/api/users" method="POST" manual
      data-wcs="body: ${bodyPath}; trigger: submitRequest; value: submitResult"></wcs-fetch>
    <wcs-state></wcs-state>
  `;
  document.body.appendChild(host);
  const stateEl = host.querySelector("wcs-state") as any;
  stateEl.setInitialState(state);
  await stateEl.connectedCallbackPromise;
  await getBindingsReady(document);
  return {
    host,
    name: host.querySelector("input.name") as HTMLInputElement,
    email: host.querySelector("input.email") as HTMLInputElement,
    button: host.querySelector("button") as HTMLButtonElement,
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve));
};

function typeInto(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

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

/** これまでに送った要求の本文（JSON をパースしたもの。本文なしは null）。 */
const sentBodies = (): any[] =>
  fetchSpy.mock.calls.map(([, init]: any) => (init?.body == null ? null : JSON.parse(init.body)));

describe("integration: body 付きの POST（README §4）", () => {
  it("送信のたびに作る本文は、毎回届く（入力を変えない再送信も）", async () => {
    const m = await mount(README_STATE(), "submitBody");
    host = m.host;

    typeInto(m.name, "Ada");
    typeInto(m.email, "ada@example.com");
    m.button.click();
    await settle();

    typeInto(m.name, "Grace");
    m.button.click();
    await settle();

    // 入力を変えない再送信（失敗の後の再試行と同じ形）
    m.button.click();
    await settle();

    expect(sentBodies()).toEqual([
      { name: "Ada", email: "ada@example.com" },
      { name: "Grace", email: "ada@example.com" },
      { name: "Grace", email: "ada@example.com" },
    ]);
  });

  it("フォームのオブジェクトを直接束ねると、2 回目の送信は本文なしになる（旧い例・wcs/input-nested-write）", async () => {
    const m = await mount(OLD_STATE(), "newUser");
    host = m.host;

    typeInto(m.name, "Ada");
    m.button.click();
    await settle();

    typeInto(m.name, "Grace");
    m.button.click();
    await settle();

    expect(sentBodies()).toEqual([{ name: "Ada", email: "" }, null]);
  });
});
