import { describe, expect, it } from "vitest";
import { hasByAddress } from "../src/proxy/methods/hasByAddress";

function address(path: string, parentAddress: any = null): any {
  const segments = path.split(".");
  return {
    pathInfo: {
      path,
      segments,
      lastSegment: segments[segments.length - 1],
      wildcardCount: 0,
    },
    listIndex: null,
    parentAddress,
  };
}

function handler(): any {
  return {
    addressStackLength: 0,
    stateElement: { getterPaths: new Set<string>() },
  };
}

describe("hasByAddress", () => {
  it("missing と明示 undefined を区別すること", () => {
    const target = { explicit: undefined };
    expect(hasByAddress(target, address("explicit"), target, handler())).toBe(true);
    expect(hasByAddress(target, address("missing"), target, handler())).toBe(false);
  });

  it("nested slot と list index の存在を判定すること", () => {
    const target = { parent: { child: undefined }, list: [undefined] };
    const parent = address("parent");
    const child = address("parent.child", parent);
    expect(hasByAddress(target, child, target, handler())).toBe(true);

    const list = address("list");
    const item = {
      pathInfo: { path: "list.*", segments: ["list", "*"], lastSegment: "*", wildcardCount: 1 },
      listIndex: { index: 0 },
      parentAddress: list,
    } as any;
    expect(hasByAddress(target, item, target, handler())).toBe(true);
    item.listIndex.index = 1;
    expect(hasByAddress(target, item, target, handler())).toBe(false);
  });

  it("親が primitive / null の場合は false を返すこと", () => {
    const target = { leaf: "text", nul: null };
    expect(hasByAddress(target, address("leaf.child", address("leaf")), target, handler())).toBe(false);
    expect(hasByAddress(target, address("nul.child", address("nul")), target, handler())).toBe(false);
  });
});
