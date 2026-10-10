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

  it("プロパティ経由でも設定でき、すべての入力が属性へ反映する", () => {
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
    expect(element.getAttribute("mode")).toBe("exhaust");
    expect(element.getAttribute("naming")).toBe("auto");
    expect(element.getAttribute("naming-limit")).toBe("7");
    expect(element.getAttribute("reduced-motion")).toBe("animate");
    expect(element.getAttribute("types")).toBe("fade");
    expect(element.getAttribute("for")).toBe("state");

    // 配列は空白区切りのトークンとして属性へ書く
    element.types = ["forward", "slide"];
    element.participants = ["router", "state"];
    expect(element.getAttribute("types")).toBe("forward slide");
    expect(element.getAttribute("for")).toBe("router state");
    expect(element.types).toEqual(["forward", "slide"]);

    element.disabled = false;
    expect(element.hasAttribute("disabled")).toBe(false);
    expect(element.disabled).toBe(false);
  });

  it("undefined はマークアップに書かれた属性へ戻し、null は属性を外して既定へ戻す（P1 / P2）", () => {
    const host = document.createElement("div");
    host.innerHTML = '<wcs-view-transition mode="queue" naming="auto" naming-limit="5" '
      + 'reduced-motion="animate" types="forward" for="router" disabled></wcs-view-transition>';
    const element = host.firstElementChild as WcsViewTransition;
    document.body.appendChild(host);

    element.mode = "exhaust";
    element.naming = "manual";
    element.namingLimit = 9;
    element.reducedMotion = "skip";
    element.types = ["back"];
    element.participants = "state";
    element.disabled = false;
    element.mode = undefined;
    element.naming = undefined;
    element.namingLimit = undefined;
    element.reducedMotion = undefined;
    element.types = undefined;
    element.participants = undefined;
    element.disabled = undefined;
    expect(element.getAttribute("mode")).toBe("queue");
    expect(element.mode).toBe("queue");
    expect(element.naming).toBe("auto");
    expect(element.namingLimit).toBe(5);
    expect(element.reducedMotion).toBe("animate");
    expect(element.types).toEqual(["forward"]);
    expect(element.getAttribute("for")).toBe("router");
    expect(element.participants).toEqual(["router"]);
    expect(element.disabled).toBe(true);

    element.mode = null;
    element.naming = null;
    element.namingLimit = null;
    element.reducedMotion = null;
    element.types = null;
    element.participants = null;
    element.disabled = null;
    for (const name of ["mode", "naming", "naming-limit", "reduced-motion", "types", "for", "disabled"]) {
      expect(element.hasAttribute(name)).toBe(false);
    }
    expect(element.mode).toBe("latest");
    expect(element.naming).toBe("manual");
    // null は上限 0 ではなく既定の 200
    expect(element.namingLimit).toBe(200);
    expect(element.reducedMotion).toBe("skip");
    expect(element.types).toEqual([]);
    expect(element.participants).toEqual(["router", "state"]);
    expect(element.disabled).toBe(false);
  });

  it("マークアップに無い入力の undefined は属性を外したまま既定にする", () => {
    const element = create();
    document.body.appendChild(element);
    element.mode = "queue";
    element.types = ["fade"];
    element.mode = undefined;
    element.types = undefined;
    expect(element.hasAttribute("mode")).toBe(false);
    expect(element.mode).toBe("latest");
    expect(element.hasAttribute("types")).toBe(false);
    expect(element.types).toEqual([]);
  });

  it("プロパティで書いた値は付け替え（reconnect）後も残る", () => {
    const element = create({ mode: "queue", for: "router" });
    document.body.appendChild(element);
    element.mode = "exhaust";
    element.participants = ["state"];

    element.remove();
    document.body.appendChild(element);
    expect(element.mode).toBe("exhaust");
    expect(element.participants).toEqual(["state"]);
  });

  it("属性が変わらない書き込みでも、core で直接変えた値を属性の値へ揃える", () => {
    const element = create({ mode: "queue" });
    document.body.appendChild(element);
    element.core.mode = "exhaust";
    element.mode = "queue";
    expect(element.core.mode).toBe("queue");
  });

  it("upgrade 前のプロパティ代入が connect 時に取り込まれる", () => {
    const element = document.createElement("wcs-view-transition") as WcsViewTransition;
    // 定義済みタグなので accessor は既にあるが、own プロパティで意図的にシャドウする
    Object.defineProperty(element, "mode", { value: "queue", writable: true, configurable: true, enumerable: true });
    document.body.appendChild(element);
    expect(element.mode).toBe("queue");
    expect(element.getAttribute("mode")).toBe("queue");
  });

  it("upgrade 前のプロパティ代入はマークアップの属性に勝ち、undefined でその属性へ戻る", () => {
    const element = create({ mode: "exhaust" });
    Object.defineProperty(element, "mode", { value: "queue", writable: true, configurable: true, enumerable: true });
    document.body.appendChild(element);
    expect(element.mode).toBe("queue");

    element.mode = undefined;
    expect(element.getAttribute("mode")).toBe("exhaust");
    expect(element.mode).toBe("exhaust");
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
