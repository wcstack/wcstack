/**
 * config-options.test.ts — bootstrapAudio の設定の検査（setConfig）。綴りを誤った設定は黙って効かなくなるので、
 * 知らないキー・既定値と型の違う値・定義していないタグ名は投げ、何も当てない。
 */
import { describe, it, expect, afterEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

const TAG = "audio";
const tagOf = (): string => (getConfig().tagNames as unknown as Record<string, string>)[TAG];
const DEFAULT = tagOf();
const PREFIX = "[@wcstack/audio] bootstrapAudio: ";

afterEach(() => {
  setConfig({ tagNames: { [TAG]: DEFAULT } } as any);
});

describe("bootstrapAudio の設定の検査", () => {
  it.each([
    [{ tagName: { [TAG]: "x-a" } }, "tagName"],
    [{ tagNames: "x-a" }, "tagNames"],
    [{ tagNames: null }, "tagNames"],
    [{ tagNames: ["x-a"] }, "tagNames"],
    [{ tagNames: { nope: "x-a" } }, "tagNames.nope"],
    [{ tagNames: { [TAG]: 1 } }, `tagNames.${TAG}`],
    [{ createContext: {} }, "createContext"],
  ])("知らないキー・型の違う値・定義していないタグ名は投げる（%#）", (partial, key) => {
    expect(() => setConfig(partial as any)).toThrow(`${PREFIX}"${key}" is not one of its options, or not of the option's type.`);
  });

  it("投げたときは、ほかの正しい値も当てない", () => {
    expect(() => setConfig({ tagNames: { [TAG]: "x-applied", nope: "x-b" } } as any)).toThrow(`${PREFIX}"tagNames.nope"`);
    expect(tagOf()).toBe(DEFAULT);
  });

  it("undefined の値は飛ばし、正しい値は当てる", () => {
    setConfig({ tagNames: undefined } as any);
    // 知らないキーでも値が undefined なら飛ばす（3.5 の警告の検査と同じ扱い）
    expect(() => setConfig({ nope: undefined } as any)).not.toThrow();
    setConfig({ tagNames: { [TAG]: undefined } } as any);
    expect(tagOf()).toBe(DEFAULT);
    setConfig({ tagNames: { [TAG]: "x-set" } } as any);
    expect(tagOf()).toBe("x-set");
  });

  it("ほかの設定も当て、投げたときは当てない", () => {
    const before = (getConfig() as any).createContext;
    expect(() => setConfig({ createContext: () => null, nope: 1 } as any)).toThrow(`${PREFIX}"nope"`);
    expect((getConfig() as any).createContext).toBe(before);
    setConfig({ createContext: () => null } as any);
    expect((getConfig() as any).createContext).not.toBe(before);
    setConfig({ createContext: before } as any);
    expect((getConfig() as any).createContext).toBe(before);
  });
});
