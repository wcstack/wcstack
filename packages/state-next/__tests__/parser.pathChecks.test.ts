/**
 * NEW (not ported): covers the two string checks that `@wcstack/state` ran through
 * `getPathInfo` on every binding path and that the port performs inline in `parseStatePart`.
 * Messages are the ones of packages/state/src/address/PathInfo.ts; the behaviour matches
 * packages/state/__tests__/PathInfo.test.ts（セグメント数の上限）and the recursion tests that
 * write `**` into data-wcs（integration.recursionGetter / recursionIntegration）.
 */
import { describe, it, expect } from "vitest";
import { MAX_PATH_SEGMENTS } from "../src/parser/define";
import { parseBindTextsForElement } from "../src/parser/parseBindTextsForElement";
import { parseBindTextForEmbeddedNode } from "../src/parser/parseBindTextForEmbeddedNode";
import { parseStatePart } from "../src/parser/parseStatePart";

describe("parseStatePart — `**` の拒否（旧 getPathInfo の不変条件）", () => {
  it("data-wcs の右辺に `**` を書くと [wcs/recursion-unsupported] で落ちること", () => {
    let message = "";
    try {
      parseBindTextsForElement("textContent: nodes.**.total");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("[wcs/recursion-unsupported]");
    expect(message).toContain('"nodes.**.total" uses "**", which is not accepted here');
    expect(message).toContain("in a recursive getter key");
  });

  it("埋め込みノード・構造ディレクティブ・spread の右辺でも同じく落ちること", () => {
    expect(() => parseBindTextForEmbeddedNode("nodes.**.total")).toThrow(/\[wcs\/recursion-unsupported\]/);
    expect(() => parseBindTextsForElement("for: nodes.**")).toThrow(/\[wcs\/recursion-unsupported\]/);
    expect(() => parseBindTextsForElement("...: nodes.**")).toThrow(/\[wcs\/recursion-unsupported\]/);
  });

  it("空セグメントの検査が先に効くこと（旧実装の順序）", () => {
    expect(() => parseStatePart("a..**")).toThrow(/a path segment cannot be empty/);
  });

  it("フィルタ引数の中の `**` は対象外であること", () => {
    expect(parseStatePart("a|join('**')").statePathName).toBe("a");
  });
});

describe("parseStatePart — セグメント数の上限（旧 getPathInfo の検査）", () => {
  it(`${MAX_PATH_SEGMENTS} セグメントまでは通ること`, () => {
    const path = Array.from({ length: MAX_PATH_SEGMENTS }, (_, i) => `s${i}`).join('.');
    expect(parseStatePart(path).statePathName).toBe(path);
  });

  it(`${MAX_PATH_SEGMENTS + 1} セグメントは [wcs/binding-syntax] で拒否されること`, () => {
    const path = Array.from({ length: MAX_PATH_SEGMENTS + 1 }, (_, i) => `t${i}`).join('.');
    expect(() => parseStatePart(path)).toThrow(/\[wcs\/binding-syntax\]/);
    expect(() => parseStatePart(path)).toThrow(new RegExp(`has ${MAX_PATH_SEGMENTS + 1} path segments`));
    expect(() => parseBindTextsForElement(`textContent: ${path}`)).toThrow(/the limit is 512/);
  });

  it("ループ相対の先頭ドットもセグメントとして数えること（旧実装と同じ数え方）", () => {
    const body = Array.from({ length: MAX_PATH_SEGMENTS }, (_, i) => `r${i}`).join('.');
    expect(() => parseStatePart(`.${body}`)).toThrow(new RegExp(`has ${MAX_PATH_SEGMENTS + 1} path segments`));
  });
});

describe("エラーメッセージの接頭辞", () => {
  it("旧 raiseError と同じく `[@wcstack/state] ` で始まること", () => {
    expect(() => parseBindTextsForElement("noSeparator")).toThrow(/^\[@wcstack\/state\] \[wcs\/binding-syntax\] Invalid bindText/);
  });
});
