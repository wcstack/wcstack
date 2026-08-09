/**
 * webComponent/crossBoundaryAddress.ts の単体テスト。
 * 越境アドレスは「最上位が、この state 要素の、このパス」のときだけ返す。
 * 取り違えると別の行を読み書きすることになるので、照合が外れたら null。
 */
import { describe, it, expect } from "vitest";
import { getPathInfo } from "../src/address/PathInfo";
import { createStateAddress } from "../src/address/StateAddress";
import { IStateElement } from "../src/components/types";
import {
  getCrossBoundaryAddress,
  popCrossBoundaryAddress,
  pushCrossBoundaryAddress,
} from "../src/webComponent/crossBoundaryAddress";

const stateElementA = { name: "a" } as unknown as IStateElement;
const stateElementB = { name: "b" } as unknown as IStateElement;

const address = (path: string) => createStateAddress(getPathInfo(path), null);

describe("crossBoundaryAddress", () => {
  it("スタックが空なら null を返すこと", () => {
    expect(getCrossBoundaryAddress(stateElementA, "items.*.name")).toBeNull();
  });

  it("最上位が一致すればアドレスを返すこと", () => {
    const target = address("items.*.name");
    pushCrossBoundaryAddress(stateElementA, target);
    try {
      expect(getCrossBoundaryAddress(stateElementA, "items.*.name")).toBe(target);
    } finally {
      popCrossBoundaryAddress();
    }
    expect(getCrossBoundaryAddress(stateElementA, "items.*.name")).toBeNull();
  });

  it("state 要素が違えば null を返すこと", () => {
    pushCrossBoundaryAddress(stateElementA, address("items.*.name"));
    try {
      expect(getCrossBoundaryAddress(stateElementB, "items.*.name")).toBeNull();
    } finally {
      popCrossBoundaryAddress();
    }
  });

  it("パスが違えば null を返すこと", () => {
    pushCrossBoundaryAddress(stateElementA, address("items.*.name"));
    try {
      expect(getCrossBoundaryAddress(stateElementA, "items.*.other")).toBeNull();
    } finally {
      popCrossBoundaryAddress();
    }
  });

  it("入れ子では最内の越境が最上位になること", () => {
    const outerEntry = address("items.*.name");
    const innerEntry = address("nested.*.name");
    pushCrossBoundaryAddress(stateElementA, outerEntry);
    pushCrossBoundaryAddress(stateElementB, innerEntry);
    try {
      expect(getCrossBoundaryAddress(stateElementB, "nested.*.name")).toBe(innerEntry);
      expect(getCrossBoundaryAddress(stateElementA, "items.*.name")).toBeNull();
    } finally {
      popCrossBoundaryAddress();
    }
    try {
      expect(getCrossBoundaryAddress(stateElementA, "items.*.name")).toBe(outerEntry);
    } finally {
      popCrossBoundaryAddress();
    }
  });
});
