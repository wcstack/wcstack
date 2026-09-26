/**
 * messages.test.ts — 番号付きのコアのメッセージ（src/messages.ts）。
 * このファイルは診断の後付けを入れない: コアだけのページで見える形を確かめる。
 * 文面（診断の後付けが出すもの）は diagnostics.test.ts。
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CODES, raise, M, text } from "../src/messages";
import { SENTENCES } from "../src/diagnostics/messages";
import { parseBindTextsForElement } from "../src/parser/parseBindTextsForElement";
import { requireFeature } from "../src/hooks";
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
  it("コード・番号・値の形で投げる", () => {
    expect(() => parseBindTextsForElement("textContent: a|b(")).toThrow('[@wcstack/state] [wcs/binding-syntax] #108 "b("');
  });

  it("コードの無い番号は番号と値だけ", () => {
    expect(() => raise(M.Readonly)).toThrow(/^\[@wcstack\/state\] #8$/);
    expect(() => raise(M.NotAMethod, ["save"])).toThrow(/^\[@wcstack\/state\] #5 "save"$/);
  });

  it("値は文字列を引用符付きで、それ以外をそのまま並べる", () => {
    expect(text(M.ParentNotObject, ["a.b", null])).toBe('#4 "a.b" null');
    expect(text(M.IndexArityAtMost, ["$getAll", "m.*", 1, 2])).toBe('[wcs/index-arity] #902 "$getAll" "m.*" 1 2');
    expect(text(M.FilterTrailing, ['x"y', "z"])).toBe('[wcs/binding-syntax] #111 "x\\"y" "z"');
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
    expect(() => resolveFilter("date", [], [])).toThrow('[@wcstack/state] [wcs/filter-unknown] filter not found: date. "date" is in the formats add-on — install it with installFormats().');
    expect(() => resolveFilter("nosuch", [], [])).toThrow(/^\[@wcstack\/state\] \[wcs\/filter-unknown\] #501 "nosuch"$/);
  });
});

describe("4.0 で外した旧名", () => {
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

  it("旧名の宣言キー（$updatedCallback・$streams）は、正式名を示して投げる", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [old, name] of [["$updatedCallback", "$renderedCallback"], ["$streams", "$stream"]]) {
      const { el } = await load({ [old]: old === "$streams" ? {} : () => {} });
      await expect(el.connectedCallbackPromise).rejects.toThrow(`[@wcstack/state] [wcs/declaration-alias] #1601 "${old}" "${name}"`);
    }
    error.mockRestore();
  });

  it("旧名の API（$trackDependency・$untrackDependency）は、読むと正式名を示して投げる", async () => {
    const seen: string[] = [];
    const { root, el } = await load({
      go(this: any) {
        for (const key of ["$trackDependency", "$untrackDependency"]) {
          try { void this[key]; seen.push("no error"); } catch (e) { seen.push((e as Error).message); }
        }
      },
    });
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    (root.querySelector("button") as HTMLElement).click();
    expect(seen).toEqual([
      '[@wcstack/state] [wcs/name-alias] #1701 "$trackDependency" "$dependOn"',
      '[@wcstack/state] [wcs/name-alias] #1701 "$untrackDependency" "$untracked"',
    ]);
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
