/**
 * coverage-element-token.test.ts — the command-token / event-token primitive (src/token.ts):
 * the declarations `$commandTokens` / `$eventTokens` / `$on` are checked when the state loads,
 * and a token keeps delivering to its other subscribers when one throws.
 * The core alone (no diagnostics add-on): errors read as numbered messages.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

async function page(state: Record<string, any>, html = "") {
  const h = document.createElement(`cov-token-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  return { root, el };
}

/** The message the state's initialization fails with. */
async function failure(state: Record<string, any>): Promise<string> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await page(state);
    return "(no error)";
  } catch (e) {
    return (e as Error).message;
  } finally {
    error.mockRestore();
  }
}

describe("$commandTokens / $eventTokens の検査", () => {
  it.each([
    ["配列でない $commandTokens", { $commandTokens: "save" }, '[@wcstack/state] #18 "$commandTokens"'],
    ["配列でない $eventTokens", { $eventTokens: { saved: true } }, '[@wcstack/state] #18 "$eventTokens"'],
    ["空文字の名前", { $commandTokens: ["save", ""] }, '[@wcstack/state] #19 "$commandTokens"'],
    ["文字列でない名前", { $eventTokens: [1] }, '[@wcstack/state] #19 "$eventTokens"'],
    ["名前空間と同じ名前（$command）", { $commandTokens: ["$command"] }, '[@wcstack/state] #20 "$commandTokens" "$command" "$command"'],
    ["重複した名前", { $commandTokens: ["save", "load", "save"] }, '[@wcstack/state] #21 "$commandTokens" "save"'],
    ["$eventTokens の重複", { $eventTokens: ["saved", "saved"] }, '[@wcstack/state] #21 "$eventTokens" "saved"'],
  ])("%s は初期化に失敗する", async (_name, state, message) => {
    expect(await failure(state)).toBe(message);
  });

  it("$eventTokens には予約名が無い（$command という名前のイベントトークンも宣言できる）", async () => {
    const got: unknown[] = [];
    const tag = `cov-token-el-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "done", event: `${tag}:done` }] };
      done: unknown = null;
    });
    const { root } = await page(
      { $eventTokens: ["$command"], $on: { $command(_s: unknown, e: CustomEvent) { got.push(e.detail); } } },
      `<${tag} data-wcs="eventToken.done: $command"></${tag}>`,
    );
    root.querySelector(tag)!.dispatchEvent(new CustomEvent(`${tag}:done`, { detail: 1 }));
    expect(got).toEqual([1]);
  });
});

describe("$on の検査", () => {
  it.each([
    ["null の $on", { $eventTokens: ["saved"], $on: null }, "[@wcstack/state] #22"],
    ["オブジェクトでない $on", { $eventTokens: ["saved"], $on: "saved" }, "[@wcstack/state] #22"],
    ["$eventTokens に無い名前", { $eventTokens: ["saved"], $on: { savd() {} } }, '[@wcstack/state] #23 "savd"'],
    ["関数でない値", { $eventTokens: ["saved"], $on: { saved: "handler" } }, '[@wcstack/state] #24 "saved"'],
  ])("%s は初期化に失敗する", async (_name, state, message) => {
    expect(await failure(state)).toBe(message);
  });
});

describe("Token（this.$command.<name>）", () => {
  it("投げた購読者は console.error に報告して結果を undefined にし、ほかの購読者には届け続ける", async () => {
    const { el } = await page({ $commandTokens: ["save"] });
    const got: unknown[] = [];
    const boom = new Error("boom");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      el.createState("writable", (s: any) => {
        const token = s.$command.save;
        token.subscribe(() => { throw boom; });
        token.subscribe((x: unknown) => { got.push(x); return "ok"; });
        expect(token.emit(1)).toEqual([undefined, "ok"]);
      });
      expect(got).toEqual([1]);
      expect(error).toHaveBeenCalledWith('[@wcstack/state] #17 "save"', boom);
    } finally {
      error.mockRestore();
    }
  });

  it("subscribe が返す関数・unsubscribe(fn) で購読を外せ、unsubscribe は外したかどうかを返す", async () => {
    const { el } = await page({ $commandTokens: ["save"] });
    el.createState("writable", (s: any) => {
      const token = s.$command.save;
      const got: string[] = [];
      const a = (): void => { got.push("a"); };
      const b = (): void => { got.push("b"); };
      const offA = token.subscribe(a);
      token.subscribe(b);
      expect(token.size).toBe(2);
      offA();
      expect(token.size).toBe(1);
      expect(token.unsubscribe(b)).toBe(true);
      expect(token.unsubscribe(b)).toBe(false);
      expect(token.size).toBe(0);
      expect(token.emit()).toEqual([]);
      expect(got).toEqual([]);
      expect(token.name).toBe("save");
    });
  });
});
