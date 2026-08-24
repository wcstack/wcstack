/**
 * viewTransitionNaming.test.ts — 自動 view-transition-name 割り当ての単体契約
 * （docs/view-transition-design.md §6）。統合側は integration.viewTransition.test.ts。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  __test_resetTransitionNaming,
  applyTransitionName,
  getAutoNaming,
} from "../src/apply/viewTransitionNaming";
import { TRANSITION_RUNNER_KEY } from "../src/protocol/transitionRunner";
import { IContent } from "../src/structural/types";

function installRunner(naming: "manual" | "auto", namingLimit = 200): void {
  (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY] = {
    protocol: "wcs-transition-runner",
    version: 1,
    naming,
    namingLimit,
    accepts: () => true,
    run(mutate: () => void) { mutate(); return Promise.resolve(); },
  };
}

/** firstNode / lastNode だけを持つ最小の content スタブ。 */
function stubContent(firstNode: Node | null, lastNode: Node | null): IContent {
  return {
    firstNode,
    lastNode,
    mounted: true,
    appendTo() { /* unused */ },
    mountAfter() { /* unused */ },
    unmount() { /* unused */ },
    tryDestroy() { return true; },
  };
}

afterEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY];
  __test_resetTransitionNaming();
});

describe("getAutoNaming", () => {
  it("arbiter が居なければ null", () => {
    expect(getAutoNaming()).toBeNull();
  });

  it("naming=manual なら null", () => {
    installRunner("manual");
    expect(getAutoNaming()).toBeNull();
  });

  it("naming=auto なら上限つきのポリシーを返す", () => {
    installRunner("auto", 42);
    expect(getAutoNaming()).toEqual({ limit: 42 });
  });
});

describe("applyTransitionName", () => {
  it("空の content（firstNode が null）には何もしない", () => {
    installRunner("auto");
    const naming = getAutoNaming()!;
    expect(() => applyTransitionName(stubContent(null, null), "row", naming)).not.toThrow();
  });

  it("要素を含まない content（コメントのみ）には何もしない", () => {
    installRunner("auto");
    const naming = getAutoNaming()!;
    const container = document.createElement("div");
    const first = document.createComment("start");
    const last = document.createComment("end");
    container.append(first, last);
    // 走査は last で打ち切る（後続の兄弟要素を誤って掴まない）
    container.append(document.createElement("span"));

    applyTransitionName(stubContent(first, last), "row", naming);
    expect(container.querySelector("span")!.getAttribute("style")).toBeNull();
  });

  it("style を持たない要素風ノードには何もしない（never-throw）", () => {
    installRunner("auto");
    const naming = getAutoNaming()!;
    const fakeElement = { nodeType: Node.ELEMENT_NODE, nextSibling: null } as unknown as Node;
    expect(() => applyTransitionName(stubContent(fakeElement, fakeElement), "row", naming)).not.toThrow();
  });

  it("style を持たない要素は上限もカウンタも消費しない", () => {
    installRunner("auto");
    const naming = getAutoNaming()!;
    const fakeElement = { nodeType: Node.ELEMENT_NODE, nextSibling: null } as unknown as Node;
    applyTransitionName(stubContent(fakeElement, fakeElement), "row", naming);

    const element = document.createElement("li");
    applyTransitionName(stubContent(element, element), "row", naming);
    // 書けない要素で枠を焼いていたら wcs-row-2 になる
    expect(element.style.getPropertyValue("view-transition-name")).toBe("wcs-row-1");
  });

  it("命名台帳は Symbol.for のスロットに載る（state 二重ロードでも名前が衝突しない）", () => {
    installRunner("auto");
    const naming = getAutoNaming()!;
    const element = document.createElement("li");
    applyTransitionName(stubContent(element, element), "row", naming);

    const ledger = (globalThis as unknown as Record<symbol, unknown>)[
      Symbol.for("wcstack.state.view-transition-naming")
    ];
    expect(ledger).toEqual({ counter: 1, assigned: 1, warned: false });
  });

  it("最初の要素に一意な名前とグループクラスを付ける", () => {
    installRunner("auto");
    const naming = getAutoNaming()!;
    const container = document.createElement("div");
    const comment = document.createComment("lead");
    const element = document.createElement("li");
    container.append(comment, element);

    applyTransitionName(stubContent(comment, element), "row", naming);
    expect(element.style.getPropertyValue("view-transition-name")).toBe("wcs-row-1");
    expect(element.style.getPropertyValue("view-transition-class")).toBe("wcs-row");
  });

  it("同じ要素を二度命名しない", () => {
    installRunner("auto");
    const naming = getAutoNaming()!;
    const element = document.createElement("li");
    const content = stubContent(element, element);

    applyTransitionName(content, "row", naming);
    const first = element.style.getPropertyValue("view-transition-name");
    applyTransitionName(content, "row", naming);
    expect(element.style.getPropertyValue("view-transition-name")).toBe(first);
  });
});
