/**
 * event.directModifier.test.ts — `on*#direct:` on 3.x (forward compatibility with 4.0).
 *
 * 4.0 delegates `on*:` to the root and adds `#direct` to attach to the element instead. 3.x always attaches
 * to the element, and an unknown flag modifier is accepted silently, so `#direct` is already a no-op that
 * means what 4.0 means. Pinned here so a page can write `onclick#direct:` before it upgrades: the handler
 * runs, `currentTarget` is the element, `#stop` stops the page's own ancestor listeners, an ancestor's
 * `stopPropagation()` does not keep the handler from running, and nothing is reported.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { MockInstance } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { parseBindTextsForElement } from "../src/bindTextParser/parseBindTextsForElement";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let counter = 0;
let warn: MockInstance<(...args: unknown[]) => void>;
let error: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn");
  error = vi.spyOn(console, "error");
});

afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  warn.mockRestore();
  error.mockRestore();
});

async function mountPage(state: object, body: string) {
  const host = document.createElement(`direct-modifier-host-${++counter}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${body}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(state as Record<string, any>);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const byId = (id: string) => shadowRoot.getElementById(id) as HTMLElement;
  return { host, shadowRoot, byId };
}

describe("on*#direct: は 3.x で何もしない修飾子として通ること", () => {
  it("パーサは direct を修飾子として受け取り、報告しないこと", () => {
    const [result] = parseBindTextsForElement("onclick#direct,stop: save");
    expect(result.propName).toBe("onclick");
    expect(result.propModifiers).toEqual(["direct", "stop"]);
    expect(result.bindingType).toBe("event");
  });

  it("onclick#direct: handler でハンドラが呼ばれ、currentTarget は要素であること", async () => {
    const seen: (EventTarget | null)[] = [];
    const { host, byId } = await mountPage(
      { count: 0, save(this: any, event: Event) { seen.push(event.currentTarget); this.count++; } },
      `<button id="b" data-wcs="onclick#direct: save"></button><span id="c" data-wcs="textContent: count"></span>`,
    );
    byId("b").click();
    await flush();
    expect(seen).toEqual([byId("b")]);
    expect(byId("c").textContent).toBe("1");
    host.remove();
  });

  it("#direct,stop の stopPropagation はページ側の祖先のリスナーを止めること", async () => {
    let saves = 0;
    const { host, byId } = await mountPage(
      { save() { saves++; } },
      `<div id="card"><button id="b" data-wcs="onclick#direct,stop: save"></button></div>`,
    );
    const ancestor = vi.fn();
    byId("card").addEventListener("click", ancestor);
    byId("b").click();
    await flush();
    expect(saves).toBe(1);
    expect(ancestor).not.toHaveBeenCalled();
    host.remove();
  });

  it("祖先が stopPropagation() してもハンドラは呼ばれること", async () => {
    let saves = 0;
    const { host, byId } = await mountPage(
      { save() { saves++; } },
      `<div id="modal"><button id="b" data-wcs="onclick#direct: save"></button></div>`,
    );
    byId("modal").addEventListener("click", (event) => event.stopPropagation());
    byId("b").click();
    await flush();
    expect(saves).toBe(1);
    host.remove();
  });

  it("for の行の中でも行の添字を受けて呼ばれること", async () => {
    const picked: number[] = [];
    const { host, shadowRoot } = await mountPage(
      { items: ["a", "b", "c"], pick(_event: Event, index: number) { picked.push(index); } },
      `<template data-wcs="for: items"><button data-wcs="onclick#direct,prevent: pick; textContent: ."></button></template>`,
    );
    const buttons = shadowRoot.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    (buttons[2] as HTMLElement).click();
    (buttons[0] as HTMLElement).click();
    await flush();
    expect(picked).toEqual([2, 0]);
    host.remove();
  });
});
