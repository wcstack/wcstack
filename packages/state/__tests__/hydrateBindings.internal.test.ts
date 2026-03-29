import { describe, it, expect, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { __test } from "../src/hydrateBindings";
import { setStateElementByName } from "../src/stateElementByName";
import { setFragmentInfoByUUID } from "../src/structural/fragmentInfoByUUID";
import { getPathInfo } from "../src/address/PathInfo";

const { collectBindingsFromLiveNodes, hydrateBlocks, findPlaceholderComment } = __test;

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("collectBindingsFromLiveNodes", () => {
  it("空配列を渡した場合は空の結果を返す", () => {
    const result = collectBindingsFromLiveNodes([]);
    expect(result.bindingInfos).toEqual([]);
    expect(result.subscriberNodes).toEqual([]);
  });
});

describe("hydrateBlocks", () => {
  it("nodes が空のブロックはスキップされる", () => {
    const blocks = [
      { type: "for", uuid: "uuid-empty", path: "items", index: 0, nodes: [] },
    ];
    // エラーにならず完了する
    expect(() => hydrateBlocks(document.body, blocks)).not.toThrow();
  });
});

describe("findPlaceholderComment", () => {
  it("未知の type を渡すと null を返す", () => {
    document.body.innerHTML = `<!--@@wcs-for:uuid1-->`;
    const result = findPlaceholderComment(document.body, "unknown", "uuid1");
    expect(result).toBeNull();
  });

  it("マッチするコメントがない場合は null を返す", () => {
    document.body.innerHTML = `<!--@@wcs-for:other-uuid-->`;
    const result = findPlaceholderComment(document.body, "for", "nonexistent");
    expect(result).toBeNull();
  });

  it("マッチするコメントがある場合はそのコメントを返す", () => {
    document.body.innerHTML = `<!--@@wcs-for:uuid1-->`;
    const result = findPlaceholderComment(document.body, "for", "uuid1");
    expect(result).not.toBeNull();
    expect(result!.data).toBe("@@wcs-for:uuid1");
  });
});

describe("hydrateBlocks (ガードパス)", () => {
  it("for ブロックで placeholderComment が見つからない場合は if 側にフォールバック", () => {
    // placeholder なし → L230 の continue
    const li = document.createElement("li");
    document.body.appendChild(li);
    const blocks = [
      { type: "for", uuid: "no-placeholder", path: "items", index: 0, nodes: [li] },
    ];
    expect(() => hydrateBlocks(document.body, blocks)).not.toThrow();
  });

  it("if ブロックで placeholderComment が見つからない場合はスキップ", () => {
    const p = document.createElement("p");
    document.body.appendChild(p);
    const blocks = [
      { type: "if", uuid: "no-placeholder-if", path: "show", index: null, nodes: [p] },
    ];
    expect(() => hydrateBlocks(document.body, blocks)).not.toThrow();
  });

  it("for の後処理で fragmentInfo が見つからない場合はスキップ", () => {
    // placeholder あり + fragmentInfo なし → L235 の continue
    const placeholder = document.createComment("@@wcs-for:uuid-no-frag");
    document.body.appendChild(placeholder);
    const li = document.createElement("li");
    document.body.appendChild(li);
    const blocks = [
      { type: "for", uuid: "uuid-no-frag", path: "items", index: 0, nodes: [li] },
    ];
    expect(() => hydrateBlocks(document.body, blocks)).not.toThrow();
  });

});
