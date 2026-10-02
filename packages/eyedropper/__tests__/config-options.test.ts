/**
 * config-options.test.ts — bootstrapEyedropper の設定の検査（setConfig）。4.0 は知らないキー・既定値と型の違う値・
 * 定義していないタグ名を投げる。3.5 はそれをキーごとにページで一度だけ console.warn し、扱いは 3.x のまま変えない。
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";

const TAG = "eyedropper";
const PREFIX = "[@wcstack/eyedropper] bootstrapEyedropper: ";
const SUFFIX = " is not one of its options, or not of the option's type. 3.x ignores it or applies it unchecked; 4.0 throws on it.";

let mod: typeof import("../src/config");
let warn: MockInstance;
const tagsOf = (): Record<string, unknown> => mod.getConfig().tagNames as unknown as Record<string, unknown>;

beforeEach(async () => {
  // 警告済みのキーと設定はモジュールの状態なので、テストごとに読み込み直す。
  vi.resetModules();
  mod = await import("../src/config");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("bootstrapEyedropper の設定の検査（3.5 は警告だけ）", () => {
  it.each([
    [{ tagName: { [TAG]: "x-a" } }, "tagName"],
    [{ tagNames: "x-a" }, "tagNames"],
    [{ tagNames: null }, "tagNames"],
    [{ tagNames: ["x-a"] }, "tagNames"],
    [{ tagNames: { nope: "x-a" } }, "tagNames.nope"],
    [{ tagNames: { [TAG]: 1 } }, `tagNames.${TAG}`],
  ])("知らないキー・型の違う値・定義していないタグ名は投げずに警告する（%#）", (partial, key) => {
    expect(() => mod.setConfig(partial as any)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(`${PREFIX}"${key}"${SUFFIX}`);
  });

  it("同じキーはページで一度だけ警告する", () => {
    mod.setConfig({ nope: 1 } as any);
    mod.setConfig({ nope: 2 } as any);
    mod.setConfig({ tagNames: { nope: "x-a" } } as any);
    mod.setConfig({ tagNames: { nope: "x-b" } } as any);
    expect(warn.mock.calls).toEqual([[`${PREFIX}"nope"${SUFFIX}`], [`${PREFIX}"tagNames.nope"${SUFFIX}`]]);
  });

  it("正しい設定と undefined の値は警告しない", () => {
    mod.setConfig({ tagNames: { [TAG]: "x-set" } });
    mod.setConfig({ tagNames: undefined, nope: undefined } as any);
    mod.setConfig({ tagNames: { [TAG]: undefined } } as any);
    expect(warn).not.toHaveBeenCalled();
  });

  it("3.x が確かめずに取り込んだ値は、後の呼び出しの検査を変えない（既定値と比べる）", () => {
    // 3.x の tagNames の取り込みは、undefined のタグ名（4.0 でも飛ばすので警告しない）も、文字列の
    // tagNames の添字キーもそのまま入れる。いまの設定と比べると、後の正しい呼び出しを誤って警告するか、
    // 定義していない名前を見逃す。
    mod.setConfig({ tagNames: { [TAG]: undefined } } as any);
    mod.setConfig({ tagNames: { [TAG]: "x-set" } });
    expect(warn).not.toHaveBeenCalled();
    mod.setConfig({ tagNames: "ab" } as any);
    mod.setConfig({ tagNames: { 0: "x-zero" } } as any);
    expect(warn.mock.calls).toEqual([[`${PREFIX}"tagNames"${SUFFIX}`], [`${PREFIX}"tagNames.0"${SUFFIX}`]]);
  });

  it("警告しても 3.x と同じに扱う：知らないキーは無視し、正しい値は当てる", () => {
    mod.setConfig({ nope: 1, tagNames: { [TAG]: "x-set" } } as any);
    expect(mod.getConfig()).not.toHaveProperty("nope");
    expect(tagsOf()[TAG]).toBe("x-set");
  });

  it("警告しても 3.x と同じに扱う：型の違う値（タグ名は確かめずに当てる）", () => {
    const before = mod.getConfig();
    mod.setConfig({ tagNames: null } as any);
    expect(mod.getConfig()).toEqual(before);
    mod.setConfig({ tagNames: { [TAG]: 1, nope: "x-a" } } as any);
    expect(tagsOf()[TAG]).toBe(1);
    expect(tagsOf().nope).toBe("x-a");
  });
});
