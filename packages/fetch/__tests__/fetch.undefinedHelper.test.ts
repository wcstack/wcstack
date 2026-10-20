import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { registerComponents } from "../src/registerComponents";
import { setConfig } from "../src/config";

/**
 * 定義されていない `<wcs-fetch-header>` / `<wcs-fetch-body>`（docs/seam-apps.md、fw-inventory）。
 *
 * タグを自分で定義するページ（autoloader の包み）が `<wcs-fetch>` だけを定義すると、補助のタグは
 * 素の要素のままで、そのヘッダーや本文は何も言わずに要求から落ちていた。今は要素ごとに 1 回
 * `[wcs/fetch-helper-undefined]` で言う。定義の無いタグは、補助のタグの名前を未定義の名前に
 * 変えて作る（登録はすでに済んでいる）。
 */

function createMockResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve({ ok: true }),
    text: () => Promise.resolve("{}"),
  } as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  registerComponents();
});

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(createMockResponse());
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setConfig({ tagNames: { fetchHeader: "wcs-fetch-header", fetchBody: "wcs-fetch-body" } });
  fetchSpy.mockRestore();
  warn.mockRestore();
  document.body.innerHTML = "";
});

const said = (): string[] =>
  warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes("[wcs/fetch-helper-undefined]"));

function mount(inner: string): any {
  const el = document.createElement("wcs-fetch") as any;
  el.setAttribute("url", "/api/items");
  el.setAttribute("method", "POST");
  el.setAttribute("manual", "");
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

describe("定義されていない補助のタグ（[wcs/fetch-helper-undefined]）", () => {
  it("定義の無いヘッダーのタグは送らず、要素ごとに 1 回だけ言う", async () => {
    setConfig({ tagNames: { fetchHeader: "x-undefined-header" } });
    const el = mount(`<x-undefined-header name="Authorization" value="Bearer t"></x-undefined-header>`);
    await el.fetch();
    await el.fetch();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(said()).toHaveLength(1);
    expect(said()[0]).toContain("<x-undefined-header> inside this <wcs-fetch> is not defined, so its header is not sent");
    expect(warn.mock.calls.find((c: unknown[]) => String(c[0]).includes("[wcs/fetch-helper-undefined]"))?.[1]).toBe(el);
  });

  it("定義の無い本文のタグは送らずに言う", async () => {
    setConfig({ tagNames: { fetchBody: "x-undefined-body" } });
    const el = mount(`<x-undefined-body>{"name":"a"}</x-undefined-body>`);
    await el.fetch();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body ?? null).toBeNull();
    expect(said()).toHaveLength(1);
    expect(said()[0]).toContain("so its body is not sent");
  });

  it("定義されたタグでは言わない", async () => {
    const el = mount(`<wcs-fetch-header name="X-A" value="1"></wcs-fetch-header><wcs-fetch-body>{"a":1}</wcs-fetch-body>`);
    await el.fetch();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-A"]).toBe("1");
    expect(init.body).toBe(`{"a":1}`);
    expect(said()).toHaveLength(0);
  });
});
