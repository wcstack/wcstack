/**
 * config-options.test.ts — bootstrapMagnetometer の設定の検査（setConfig）。綴りを誤った設定は黙って効かなくなるので、
 * 知らないキー・既定値と型の違う値・定義していないタグ名は投げ、何も当てない。
 */
import { describe, it, expect, afterEach } from "vitest";
import { getConfig, setConfig } from "../src/config";

const TAG = "magnetometer";
const tagOf = (): string => (getConfig().tagNames as unknown as Record<string, string>)[TAG];
const DEFAULT = tagOf();
const PREFIX = "[@wcstack/magnetometer] bootstrapMagnetometer: ";

afterEach(() => {
  setConfig({ tagNames: { [TAG]: DEFAULT } } as any);
});

describe("bootstrapMagnetometer の設定の検査", () => {
  it.each([
    [{ tagName: { [TAG]: "x-a" } }, "tagName"],
    [{ tagNames: "x-a" }, "tagNames"],
    [{ tagNames: null }, "tagNames"],
    [{ tagNames: ["x-a"] }, "tagNames"],
    [{ tagNames: { nope: "x-a" } }, "tagNames.nope"],
    [{ tagNames: { [TAG]: 1 } }, `tagNames.${TAG}`],
  ])("知らないキー・型の違う値・定義していないタグ名は投げる（%#）", (partial, key) => {
    expect(() => setConfig(partial as any)).toThrow(`${PREFIX}"${key}" is not one of its options, or not of the option's type.`);
  });

  it("投げたときは、ほかの正しい値も当てない", () => {
    expect(() => setConfig({ tagNames: { [TAG]: "x-applied", nope: "x-b" } } as any)).toThrow(`${PREFIX}"tagNames.nope"`);
    expect(tagOf()).toBe(DEFAULT);
  });

  it("undefined の値は飛ばし、正しい値は当てる", () => {
    setConfig({ tagNames: undefined } as any);
    setConfig({ tagNames: { [TAG]: undefined } } as any);
    expect(tagOf()).toBe(DEFAULT);
    setConfig({ tagNames: { [TAG]: "x-set" } } as any);
    expect(tagOf()).toBe("x-set");
  });
});
