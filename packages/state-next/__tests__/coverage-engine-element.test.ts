/**
 * coverage-engine-element.test.ts — engine paths seen through a real `<wcs-state>`:
 * `$stateElement` and the `$renderedCallback` report.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, getBindingsReady } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-engine-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
    await flush();
  };
  return { root, el, write };
}

describe("$stateElement", () => {
  it("メソッドの this.$stateElement はその <wcs-state> 要素", async () => {
    const { el } = await page("", { who(this: any) { return this.$stateElement; } });
    let got: unknown;
    el.createState("readonly", (s: any) => { got = s.who(); });
    expect(got).toBe(el);
  });
});

describe("$renderedCallback", () => {
  it("同じパスのバインディングが二つ適用されても、パスは一度だけ渡る", async () => {
    const calls: unknown[][] = [];
    const { root, write } = await page(`<p>{{ count }}</p><span>{{ count }}</span>`, {
      count: 1,
      $renderedCallback(paths: string[], indexes: Record<string, number[][]>) { calls.push([paths, indexes]); },
    });
    await write((s) => { s.count = 2; });
    expect(root.querySelector("p")!.textContent).toBe("2");
    expect(root.querySelector("span")!.textContent).toBe("2");
    expect(calls).toEqual([[["count"], {}]]);
  });

  it("then を持たないオブジェクトを返しても何も起きない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[][] = [];
    const { write } = await page(`<p>{{ count }}</p>`, {
      count: 1,
      $renderedCallback(paths: string[]) {
        calls.push(paths);
        return { then: "not a function" };
      },
    });
    await write((s) => { s.count = 2; });
    expect(calls).toEqual([["count"]]);
    expect(error).not.toHaveBeenCalled();
  });

  it("同期に投げた失敗は console.error に出て、描画は済んでいる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("sync failure");
    const { root, write } = await page(`<p>{{ count }}</p>`, {
      count: 1,
      $renderedCallback() { throw failure; },
    });
    await write((s) => { s.count = 2; });
    expect(root.querySelector("p")!.textContent).toBe("2");
    expect(error).toHaveBeenCalledWith(failure);
  });

  it("async の失敗（reject）も console.error に出る", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("async failure");
    const { root, write } = await page(`<p>{{ count }}</p>`, {
      count: 1,
      async $renderedCallback() { throw failure; },
    });
    await write((s) => { s.count = 2; });
    expect(root.querySelector("p")!.textContent).toBe("2");
    expect(error).toHaveBeenCalledWith(failure);
  });
});
