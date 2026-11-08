// delegateEvents(): h()'s on… handlers delegated to one listener per type on a root (opt-in).

import { describe, it, expect, vi, afterEach } from "vitest";
import { h, For, signal, createRoot, flushSync, delegateEvents } from "../src/dom.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0).reverse()) c();
  document.body.innerHTML = "";
});
const delegate = (types?: string[], root?: EventTarget): void => {
  cleanups.push(delegateEvents(types, root));
};
const mount = <T extends Node>(node: T): T => {
  document.body.appendChild(node);
  return node;
};

describe("delegateEvents: 委譲したハンドラ", () => {
  it("要素にリスナーを付けず、文書の 1 本のリスナーから呼ぶ（currentTarget と this は要素）", () => {
    delegate(["click"]);
    const add = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const seen: unknown[] = [];
    const onClick = vi.fn(function (this: unknown, e: Event) {
      seen.push(this, e.currentTarget, (e.target as Element).localName);
    });
    try {
      const button = mount(h("button", { onClick }, h("span", null, "go")) as HTMLElement);
      expect(add).not.toHaveBeenCalled();
      (button.firstChild as HTMLElement).click();
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([button, button, "span"]);
    } finally {
      add.mockRestore();
    }
  });

  it("内側から外側へ順に呼び、stopPropagation で外側を止める。呼んだ後の currentTarget は元に戻る", () => {
    delegate(["click"]);
    const order: string[] = [];
    let event: Event | null = null;
    const outer = mount(h("div", { onClick: () => order.push("outer") },
      h("p", { onClick: (e: Event) => { order.push("inner"); event = e; } }, "x"),
      h("i", { onClick: (e: Event) => { order.push("stopper"); e.stopPropagation(); } }, "y"),
    ) as HTMLElement);
    (outer.children[0] as HTMLElement).click();
    expect(order).toEqual(["inner", "outer"]);
    expect(event!.currentTarget).toBeNull();
    order.length = 0;
    (outer.children[1] as HTMLElement).click();
    expect(order).toEqual(["stopper"]);
  });

  it("ハンドラが投げても、報告して外側のハンドラは呼ぶ（要素のリスナーと同じ）", () => {
    delegate(["click"]);
    const g = globalThis as { reportError?: (e: unknown) => void };
    const prev = g.reportError;
    const reported = vi.fn();
    g.reportError = reported;
    try {
      const outer = vi.fn();
      const root = mount(h("div", { onClick: outer }, h("b", { onClick: () => { throw new Error("boom"); } }, "x")) as HTMLElement);
      (root.firstChild as HTMLElement).click();
      expect(reported).toHaveBeenCalledTimes(1);
      expect(outer).toHaveBeenCalledTimes(1);
    } finally {
      g.reportError = prev;
    }
  });

  it("onclick と onClick のどちらも委譲し、委譲しない種類（focus・独自のイベント）は要素のリスナーのまま", () => {
    delegate(["click"]);
    const lower = vi.fn();
    const custom = vi.fn();
    const focus = vi.fn();
    const el = mount(h("button", { onclick: lower, "onadd-to-cart": custom, onFocus: focus }) as HTMLButtonElement);
    el.click();
    el.dispatchEvent(new CustomEvent("add-to-cart"));
    el.focus();
    expect([lower.mock.calls.length, custom.mock.calls.length, focus.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it("delegateEvents の前に作った要素はリスナーのまま。文書の外の要素は委譲では呼ばれない", () => {
    const early = vi.fn();
    const before = mount(h("button", { onClick: early }) as HTMLButtonElement);
    delegate(["click"]);
    const late = vi.fn();
    const detached = h("button", { onClick: late }) as HTMLButtonElement;
    before.click();
    detached.click(); // 文書に無いので root に届かない
    expect(early).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();
    mount(detached).click();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("既定はすべての委譲できる種類。止める関数を呼ぶとその root で委譲しなくなる", () => {
    const stop = delegateEvents();
    const onInput = vi.fn();
    const onKeyDown = vi.fn();
    const input = mount(h("input", { onInput, onKeyDown }) as HTMLInputElement);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    expect([onInput.mock.calls.length, onKeyDown.mock.calls.length]).toEqual([1, 1]);
    stop();
    stop(); // 2 回目は何もしない
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onInput).toHaveBeenCalledTimes(1);
    // 止めた後に作った要素はリスナーに戻る
    const after = vi.fn();
    mount(h("button", { onClick: after }) as HTMLButtonElement).click();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("同じ root に 2 回呼んでも 1 回だけ呼ぶ。先に止めた方は、もう一方が付けたリスナーを外さない", () => {
    const first = delegateEvents(["click"]);
    const second = delegateEvents(["click"]); // 何も足さない
    cleanups.push(first);
    const onClick = vi.fn();
    const el = mount(h("button", { onClick }) as HTMLButtonElement);
    el.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    second();
    el.click();
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("泡立たない・composed でない・touch のイベントは名前を挙げて断る", () => {
    expect(() => delegateEvents(["focus"])).toThrow(/"focus" cannot be delegated/);
    expect(() => delegateEvents(["change"])).toThrow(/"change" cannot be delegated/);
    expect(() => delegateEvents(["touchstart"])).toThrow(/Delegable: beforeinput, click/);
    // 断ったときは何も付けていない
    const onClick = vi.fn();
    const el = mount(h("button", { onClick }) as HTMLButtonElement);
    el.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("delegateEvents: shadow root", () => {
  it("開いた shadow root の中の要素も、文書のリスナーが composedPath から見つける", () => {
    delegate(["click"]);
    const host = mount(document.createElement("div"));
    const shadow = host.attachShadow({ mode: "open" });
    const onClick = vi.fn((e: Event) => e.currentTarget);
    const inner = h("button", { onClick }, "in") as HTMLButtonElement;
    shadow.appendChild(inner);
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.results[0].value).toBe(inner);
  });

  it("shadow root と文書の両方に委譲しても、1 回のイベントでハンドラは 1 回", () => {
    const host = mount(document.createElement("div"));
    const shadow = host.attachShadow({ mode: "open" });
    delegate(["click"], shadow);
    delegate(["click"]);
    const onClick = vi.fn();
    const outer = vi.fn();
    const wrapper = h("section", { onClick: outer }) as HTMLElement;
    mount(wrapper).appendChild(host);
    const inner = h("button", { onClick }, "in") as HTMLButtonElement;
    shadow.appendChild(inner);
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1); // shadow root の外の先祖も同じ歩きで
  });
});

describe("delegateEvents: リスト（js-framework-benchmark の行）", () => {
  it("For の行のハンドラを委譲で呼び、行を消しても removeEventListener は呼ばない", () => {
    delegate(["click"]);
    const rows = signal([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const picked: number[] = [];
    const remove = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    try {
      let list!: HTMLElement;
      const dispose = createRoot((d) => {
        list = mount(h("ul", null, For(rows, (row) => h("li", null, h("a", { onClick: () => picked.push(row.id) }, String(row.id))), { key: (r) => r.id })) as HTMLElement);
        return d;
      });
      (list.querySelectorAll("a")[1] as HTMLElement).click();
      expect(picked).toEqual([2]);
      rows.set([]);
      flushSync();
      dispose();
      expect(remove).not.toHaveBeenCalled();
    } finally {
      remove.mockRestore();
    }
  });
});
