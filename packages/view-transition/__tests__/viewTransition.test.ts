import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapViewTransition } from "../src/bootstrapViewTransition";
import { WcsViewTransition } from "../src/components/ViewTransition";
import { TRANSITION_RUNNER_KEY, getTransitionRunner } from "../src/protocol/transitionRunner";
import { flushMicrotasks, installViewTransitionMock, ViewTransitionMock } from "./mocks";
import { getStates } from "./helpers";

bootstrapViewTransition();

function clearRunnerSlot(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY];
}

function create(attributes: Record<string, string> = {}): WcsViewTransition {
  const element = document.createElement("wcs-view-transition") as WcsViewTransition;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

describe("<wcs-view-transition>", () => {
  let mock: ViewTransitionMock;

  beforeEach(() => {
    mock = installViewTransitionMock();
    clearRunnerSlot();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    mock.uninstall();
    clearRunnerSlot();
    vi.restoreAllMocks();
  });

  it("タグが定義されている", () => {
    expect(customElements.get("wcs-view-transition")).toBe(WcsViewTransition);
  });

  it("connect で runner を install し、disconnect で解放する", () => {
    const element = create();
    document.body.appendChild(element);
    expect(getTransitionRunner("state")).toBe(element.core as never);

    element.remove();
    expect(getTransitionRunner("state")).toBeNull();
  });

  it("disconnect は未適用の変更を落とさずに適用してから降りる", () => {
    const element = create();
    document.body.appendChild(element);
    let applied = false;
    element.core.run(() => { applied = true; });
    // 遷移待ち: まだ適用されていない
    expect(applied).toBe(false);

    element.remove();
    expect(applied).toBe(true);
    expect(getTransitionRunner("state")).toBeNull();
  });

  it("install に失敗した要素は disconnect で他人のスロットを壊さない", () => {
    vi.spyOn(console, "warn").mockImplementation(() => { /* silence */ });
    const first = create();
    const second = create();
    document.body.appendChild(first);
    document.body.appendChild(second);
    expect(getTransitionRunner("state")).toBe(first.core as never);

    second.remove();
    expect(getTransitionRunner("state")).toBe(first.core as never);
  });

  it("属性が Core の設定へ写る", () => {
    const element = create({
      mode: "queue",
      naming: "auto",
      "naming-limit": "5",
      "reduced-motion": "animate",
      types: "forward slide",
      for: "router",
      disabled: "",
    });
    document.body.appendChild(element);

    expect(element.mode).toBe("queue");
    expect(element.naming).toBe("auto");
    expect(element.namingLimit).toBe(5);
    expect(element.reducedMotion).toBe("animate");
    expect(element.types).toEqual(["forward", "slide"]);
    expect(element.participants).toEqual(["router"]);
    expect(element.disabled).toBe(true);
  });

  it("属性の除去は既定へ戻す", () => {
    const element = create({ mode: "queue", naming: "auto", "naming-limit": "5", "reduced-motion": "animate", types: "a", for: "router" });
    document.body.appendChild(element);

    for (const name of ["mode", "naming", "naming-limit", "reduced-motion", "types", "for"]) {
      element.removeAttribute(name);
    }
    expect(element.mode).toBe("latest");
    expect(element.naming).toBe("manual");
    expect(element.namingLimit).toBe(200);
    expect(element.reducedMotion).toBe("skip");
    expect(element.types).toEqual([]);
    expect(element.participants).toEqual(["router", "state"]);
  });

  it("同値の属性変更は無視される", () => {
    const element = create({ mode: "queue" });
    document.body.appendChild(element);
    element.attributeChangedCallback("mode", "queue", "queue");
    expect(element.mode).toBe("queue");
  });

  it("プロパティ経由でも設定でき、disabled は属性へ反映する", () => {
    const element = create();
    document.body.appendChild(element);

    element.mode = "exhaust";
    element.naming = "auto";
    element.namingLimit = 7;
    element.reducedMotion = "animate";
    element.types = "fade";
    element.participants = ["state"];
    element.disabled = true;

    expect(element.mode).toBe("exhaust");
    expect(element.naming).toBe("auto");
    expect(element.namingLimit).toBe(7);
    expect(element.reducedMotion).toBe("animate");
    expect(element.types).toEqual(["fade"]);
    expect(element.participants).toEqual(["state"]);
    expect(element.hasAttribute("disabled")).toBe(true);

    element.disabled = false;
    expect(element.hasAttribute("disabled")).toBe(false);
  });

  it("upgrade 前のプロパティ代入が connect 時に取り込まれる", () => {
    const element = document.createElement("wcs-view-transition") as WcsViewTransition;
    // 定義済みタグなので accessor は既にあるが、own プロパティで意図的にシャドウする
    Object.defineProperty(element, "mode", { value: "queue", writable: true, configurable: true, enumerable: true });
    document.body.appendChild(element);
    expect(element.mode).toBe("queue");
  });

  it("active / error を :state() へ反映する", async () => {
    const element = create();
    document.body.appendChild(element);

    element.core.run(() => { /* noop */ });
    await flushMicrotasks();
    expect(element.active).toBe(true);
    expect(getStates(element)).toContain("active");
    expect(element.debugStates).toContain("active");

    mock.transitions[0].finish();
    await flushMicrotasks();
    expect(getStates(element)).not.toContain("active");

    mock.throwOnStart = new Error("nope");
    element.core.run(() => { /* noop */ });
    await flushMicrotasks();
    expect(element.error).toBeInstanceOf(Error);
    expect(getStates(element)).toContain("error");
  });

  it("debug-states 属性があると data 属性にも反映する", async () => {
    const element = create({ "debug-states": "" });
    document.body.appendChild(element);

    element.core.run(() => { /* noop */ });
    await flushMicrotasks();
    expect(element.hasAttribute("data-wcs-state-active")).toBe(true);
  });

  it("attachInternals が無い / throw する環境では反映を諦める（never-throw）", async () => {
    const original = HTMLElement.prototype.attachInternals;
    (HTMLElement.prototype as unknown as Record<string, unknown>).attachInternals = () => {
      throw new Error("no internals here");
    };
    try {
      const element = create();
      document.body.appendChild(element);
      expect(element.debugStates).toEqual([]);
      element.core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(element.active).toBe(true);
    } finally {
      (HTMLElement.prototype as unknown as Record<string, unknown>).attachInternals = original;
    }

    delete (HTMLElement.prototype as unknown as Record<string, unknown>).attachInternals;
    try {
      const element = create();
      document.body.appendChild(element);
      expect(element.debugStates).toEqual([]);
    } finally {
      (HTMLElement.prototype as unknown as Record<string, unknown>).attachInternals = original;
    }
  });

  it("skip コマンドが Core へ委譲される", async () => {
    const element = create();
    document.body.appendChild(element);
    element.core.run(() => { /* noop */ });
    await flushMicrotasks();

    element.skip();
    expect(mock.transitions[0].skipped).toBe(true);
  });

  it("wcBindable が Core の properties / commands を継承する", () => {
    expect(WcsViewTransition.wcBindable.protocol).toBe("wc-bindable");
    expect(WcsViewTransition.wcBindable.properties.map((p) => p.name)).toEqual(["active", "error"]);
    expect(WcsViewTransition.wcBindable.commands?.map((c) => c.name)).toEqual(["skip"]);
    expect(WcsViewTransition.wcBindable.inputs?.map((i) => i.name)).toContain("participants");
  });
});
