/**
 * messages.test.ts — 番号付きのコアのメッセージ（src/messages.ts）。
 * このファイルは最後の describe まで診断の後付けを入れない: コアだけのページで見える形
 * （番号と値。`[wcs/<code>]` は 4.0.0-rc.3 まではコアが付けていたが、以後は診断の後付けが付ける）を確かめる。
 * 文面（診断の後付けが出すもの）は diagnostics.test.ts。
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raise, M, text } from "../src/messages";
import { CODES, SENTENCES } from "../src/diagnostics/messages";
import { parseBindTextsForElement } from "../src/parser/parseBindTextsForElement";
import { installFeatures, requireFeature } from "../src/hooks";
import { diagnostics } from "../src/features/diagnostics";
import { installCoreFilters } from "../src/filters/core";
import { resolveFilter } from "../src/filters/registry";
import { bootstrapState, getBindingsReady } from "../src/index";

/** The numbers `M` declares, read from the source (a const enum has no runtime object to list). */
function declaredNumbers(): number[] {
  const src = readFileSync(join(process.cwd(), "src/messages.ts"), "utf8");
  const body = /export const enum M \{([\s\S]*?)\n\}/.exec(src)![1];
  return [...body.matchAll(/^\s*\w+ = (\d+),/gm)].map((m) => Number(m[1]));
}

describe("コアだけのメッセージ（診断の後付けなし）", () => {
  it("番号・値の形で投げる（コードは付かない）", () => {
    expect(() => parseBindTextsForElement("textContent: a|b(")).toThrow('[@wcstack/state] #108 "b("');
  });

  it("コードの枠の無い番号（1〜99）も同じ形", () => {
    expect(() => raise(M.Readonly)).toThrow(/^\[@wcstack\/state\] #8$/);
    expect(() => raise(M.NotAMethod, ["save"])).toThrow(/^\[@wcstack\/state\] #5 "save"$/);
  });

  it("値は文字列を引用符付きで、それ以外をそのまま並べる", () => {
    expect(text(M.ParentNotObject, ["a.b", null])).toBe('#4 "a.b" null');
    expect(text(M.IndexArityAtMost, ["$getAll", "m.*", 1, 2])).toBe('#902 "$getAll" "m.*" 1 2');
    expect(text(M.FilterTrailing, ['x"y', "z"])).toBe('#111 "x\\"y" "z"');
  });

  it("console に出すものも同じ形（バインディングの失敗）", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    bootstrapState();
    document.body.innerHTML = `<wcs-state></wcs-state><p>{{ bad }}</p>`;
    const el = document.body.querySelector("wcs-state") as any;
    el.setInitialState({ get bad() { throw new Error("boom"); } });
    await getBindingsReady(document);
    expect(err).toHaveBeenCalledWith('[@wcstack/state] #12 "text" "bad"', expect.any(Error));
    err.mockRestore();
    document.body.innerHTML = "";
  });

  it("後付けの無いページで出会う壁は文章のまま残す", () => {
    expect(() => requireFeature("temporal", "$watch")).toThrow("[@wcstack/state] [wcs/feature-not-installed] $watch needs the add-on @wcstack/state/features/temporal");
    installCoreFilters();
    expect(() => resolveFilter("date", [], [])).toThrow('[@wcstack/state] [wcs/filter-unknown] filter not found: date. "date" is in the formats add-on — install it with installFeatures([formats]) from "@wcstack/state/features/formats".');
    expect(() => resolveFilter("nosuch", [], [])).toThrow(/^\[@wcstack\/state\] #501 "nosuch"$/);
  });
});

/** A root `<wcs-state>` over `state`, with a button that calls its `go`. */
async function load(state: Record<string, any>) {
  bootstrapState();
  const h = document.createElement("div");
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state><button data-wcs="onclick: go">go</button>`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  return { root, el };
}

/** How a root over `state` initializes: "ok", or the failure's message. */
async function init(state: Record<string, any>): Promise<string> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { el } = await load(state);
    await el.connectedCallbackPromise;
    return "ok";
  } catch (e) {
    return (e as Error).message;
  } finally {
    error.mockRestore();
  }
}

/** What reading each `$` name in a handler gives: its type, or the message it throws. */
async function readNames(names: string[]): Promise<string[]> {
  const seen: string[] = [];
  const { root, el } = await load({
    go(this: any) {
      for (const key of names) {
        try { seen.push(typeof this[key]); } catch (e) { seen.push((e as Error).message); }
      }
    },
  });
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  (root.querySelector("button") as HTMLElement).click();
  return seen;
}

const REMOVED_DECLARATIONS: [string, Record<string, any>][] = [
  ["$scan", { $scan: {} }],
  ["$updatedCallback", { $updatedCallback() {} }],
  ["$streams", { $streams: {} }],
];

// 4.0.0-rc.3 まではコアが検出していた。以後は診断の後付けの仕事（最後の describe で確かめる）
describe("4.0 で外した 3.x の旧名（診断の後付けなし: 他の知らない $ キーと同じく何もしない）", () => {
  it.each(REMOVED_DECLARATIONS)("宣言キー %s は無視され、状態は読み込める", async (_name, decl) => {
    expect(await init({ v: 1, ...decl })).toBe("ok");
  });

  it("API $trackDependency・$untrackDependency は、知らない $ の名前（$nosuch）と同じく undefined を読む", async () => {
    expect(await readNames(["$trackDependency", "$untrackDependency", "$nosuch"])).toEqual(["undefined", "undefined", "undefined"]);
  });
});

describe("番号の表", () => {
  const numbers = declaredNumbers();

  it("番号は重複しない", () => {
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("各番号の百の位にコードの枠がある（1〜99 はコード無し）", () => {
    for (const n of numbers) {
      expect((n / 100) | 0).toBeLessThan(CODES.length);
      if (n >= 100) expect(CODES[(n / 100) | 0]).not.toBe("");
    }
  });

  it("診断の後付けに、すべての番号の文面がある（余分も無い）", () => {
    expect(Object.keys(SENTENCES).map(Number).sort((a, b) => a - b)).toEqual([...numbers].sort((a, b) => a - b));
  });
});

// ここから診断の後付けを入れる（このファイルの最後の describe であること）
describe("診断の後付けを入れると、同じ番号のメッセージにコードと文面が付く", () => {
  it("入れる前は番号と値、入れた後は [wcs/<code>] と文面（1〜99 はコード無しで文面だけ）", () => {
    const syntax = () => parseBindTextsForElement("textContent: a|b(");
    expect(syntax).toThrow(/^\[@wcstack\/state\] #108 "b\("$/);
    expect(() => raise(M.Readonly)).toThrow(/^\[@wcstack\/state\] #8$/);
    installFeatures([diagnostics]);
    expect(syntax).toThrow(/^\[@wcstack\/state\] \[wcs\/binding-syntax\] Invalid filter format: missing closing parenthesis in "b\("\./);
    expect(() => raise(M.Readonly)).toThrow(/^\[@wcstack\/state\] This state is readonly\.$/);
    expect(text(M.IndexArityAtMost, ["$getAll", "m.*", 1, 2])).toBe('[wcs/index-arity] $getAll("m.*") takes at most 1 index(es), got 2.');
  });

  it("4.0 で外した 3.x の旧名は、4.0.0-rc.3 と同じ文面で投げる（宣言は読み込みで、API は読んだ時点で）", async () => {
    // (diagnostics was installed by the previous test of this describe)
    expect(await init({ v: 1, $scan: {} })).toBe("[@wcstack/state] $scan was removed (use $watch or $on)");
    expect(await init({ v: 1, $updatedCallback() {} })).toBe("[@wcstack/state] [wcs/declaration-alias] $updatedCallback was removed: write $renderedCallback.");
    expect(await init({ v: 1, $streams: {} })).toBe("[@wcstack/state] [wcs/declaration-alias] $streams was removed: write $stream.");
    // (a value of undefined is no declaration, as before)
    expect(await init({ v: 1, $scan: undefined, $updatedCallback: undefined, $streams: undefined })).toBe("ok");
    expect(await readNames(["$trackDependency", "$untrackDependency", "$nosuch"])).toEqual([
      "[@wcstack/state] [wcs/name-alias] $trackDependency was removed: write $dependOn.",
      "[@wcstack/state] [wcs/name-alias] $untrackDependency was removed: write $untracked.",
      "undefined",
    ]);
  });
});
