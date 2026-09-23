/**
 * 明示のプロパティ形 `.name:`（要件 B5・docs/state-3x-plan.ja.md D34）。
 * `on` で始まる名前もイベントにせず要素のプロパティとして束縛すること、ドットの無い形は従来どおり
 * （`online:` はイベント）であること、名前空間の語と空のセグメントを拒否することを固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { parseBindTextsForElement } from "../src/bindTextParser/parseBindTextsForElement";
import type { IWcBindable } from "../src/event/types";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

class ExStatus extends HTMLElement {
  online = false;
  only = "";
}
customElements.define("ex-explicit-status", ExStatus);

/** 要素が張った DOM イベント名を記録する（`addEventListener` の横取り） */
function recordListeners(element: Element): string[] {
  const names: string[] = [];
  const original = element.addEventListener.bind(element);
  (element as any).addEventListener = (type: string, ...rest: unknown[]) => {
    names.push(type);
    return (original as any)(type, ...rest);
  };
  return names;
}

/**
 * `Element.prototype` ごと横取りする（行の実体化で後から生成される要素を見るため）。
 * 記録するのは `tagName::type` の組。
 */
async function withListenerRecorder(tagName: string, body: () => Promise<void>): Promise<string[]> {
  const names: string[] = [];
  const original = Element.prototype.addEventListener;
  Element.prototype.addEventListener = function (this: Element, type: string, ...rest: unknown[]) {
    if (this.tagName.toLowerCase() === tagName) names.push(type);
    return (original as any).call(this, type, ...rest);
  } as typeof original;
  try {
    await body();
  } finally {
    Element.prototype.addEventListener = original;
  }
  return names;
}

describe("明示のプロパティ形の解析", () => {
  it("`.online:` はプロパティ束縛、`online:` は従来どおりイベント束縛であること", () => {
    const [explicit, event] = parseBindTextsForElement(".online#ro: isOnline; online: refresh");
    expect(explicit).toMatchObject({ bindingType: "prop", propName: "online", propSegments: ["online"], propModifiers: ["ro"] });
    expect(event).toMatchObject({ bindingType: "event", propName: "online" });
  });

  it("入れ子のプロパティと入力フィルタを受けること", () => {
    const [result] = parseBindTextsForElement(".detail.onset|number: start");
    expect(result).toMatchObject({ bindingType: "prop", propName: "detail.onset", propSegments: ["detail", "onset"] });
    expect(result.inFilters.map((f) => f.filterName)).toEqual(["number"]);
  });

  // `.state: x` / `.state.taxRate: x` は要件 B14③ の左辺名前空間（`<wcs-state mount>` の注入宣言）
  // と曖昧なので、他の名前空間の語と同じ語彙で拒否する（D34）
  it.each([".: x", "..online: x", ".online.: x", ".class.on: x", ".attr.title: x", ".style.color: x", ".command.go: x", ".eventToken.done: x", ".state: x", ".state.taxRate: x"])(
    "%s を [wcs/binding-syntax] で拒否すること",
    (bindText) => {
      expect(() => parseBindTextsForElement(bindText)).toThrow(/\[wcs\/binding-syntax\].*leading "\."/);
    },
  );
});

describe("明示のプロパティ形の適用", () => {
  it("`on` で始まるプロパティに値を書き、更新に追従すること", async () => {
    const host = document.createElement("explicit-prop-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<ex-explicit-status data-wcs=".online: isOnline; .only: label"></ex-explicit-status>` +
      `<input data-wcs=".value: name">` +
      `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({ isOnline: true, label: "a", name: "x" });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    const status = shadowRoot.querySelector("ex-explicit-status") as ExStatus;
    const input = shadowRoot.querySelector("input") as HTMLInputElement;
    expect(status.online).toBe(true);
    expect(status.only).toBe("a");
    expect(input.value).toBe("x");

    const stateElement = getStateElement(shadowRoot)!;
    stateElement.createState("writable", (s: any) => { s.isOnline = false; s.label = "b"; });
    await flush();
    expect(status.online).toBe(false);
    expect(status.only).toBe("b");

    // `.value` は `value` と同じ束縛 — 入力は双方向に書き戻す
    input.value = "typed";
    input.dispatchEvent(new Event("input"));
    await flush();
    let name: unknown;
    stateElement.createState("readonly", (s: any) => { name = s.name; });
    expect(name).toBe("typed");
    host.remove();
  });
});

/**
 * プロパティ束縛に DOM イベントリスナを張らないこと（`event/handler.ts` の門は綴りではなく
 * `bindingType` で判定する）。`.online:` が `"line"` を購読していた回帰の番人。
 */
describe("プロパティ束縛はリスナを張らないこと", () => {
  it("`.online:` はリスナを張らず、`online:` は `line` を購読すること", async () => {
    const host = document.createElement("explicit-prop-listener-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<ex-explicit-status id="explicit" data-wcs=".online: isOnline"></ex-explicit-status>` +
      `<ex-explicit-status id="event" data-wcs="online: refresh"></ex-explicit-status>` +
      `<wcs-state></wcs-state>`;
    const explicitEl = shadowRoot.querySelector("#explicit") as ExStatus;
    const eventEl = shadowRoot.querySelector("#event") as ExStatus;
    const explicitTypes = recordListeners(explicitEl);
    const eventTypes = recordListeners(eventEl);

    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({ isOnline: true, refresh() { /* noop */ } });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    expect(explicitTypes).not.toContain("line");
    expect(explicitEl.online).toBe(true);
    expect(eventTypes).toContain("line");
    host.remove();
  });

  it("`for` 行の中でも `.online:` はリスナを張らないこと（行の内外で一致）", async () => {
    const host = document.createElement("explicit-prop-row-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    let rowEl: ExStatus | null = null;
    const types = await withListenerRecorder("ex-explicit-status", async () => {
      shadowRoot.innerHTML =
        `<template data-wcs="for: rows">` +
        `<ex-explicit-status data-wcs=".online: rows.*.flag"></ex-explicit-status>` +
        `</template>` +
        `<wcs-state></wcs-state>`;
      document.body.appendChild(host);
      const stateEl = shadowRoot.querySelector("wcs-state") as State;
      stateEl.setInitialState({ rows: [{ flag: true }] });
      await stateEl.connectedCallbackPromise;
      await State.getBindingsReady(shadowRoot);
      await flush();
      rowEl = shadowRoot.querySelector("ex-explicit-status") as ExStatus;
    });

    expect(rowEl).not.toBeNull();
    expect(rowEl!.online).toBe(true);
    expect(types).not.toContain("line");
    host.remove();
  });

  it("`spread` で配線した `once` にリスナを張らないこと（D36 の入力名）", async () => {
    class ExOnceEl extends HTMLElement {
      static wcBindable: IWcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [{ name: "once", event: "ex-once:once-changed" }],
        inputs: [{ name: "once" }],
      };
      once = false;
    }
    customElements.define("ex-explicit-once", ExOnceEl);

    const host = document.createElement("explicit-prop-spread-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<ex-explicit-once id="timer" data-wcs="...: timer"></ex-explicit-once>` +
      `<wcs-state></wcs-state>`;
    const onceEl = shadowRoot.querySelector("#timer") as ExOnceEl;
    const types = recordListeners(onceEl);

    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({ timer: { once: true } });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    expect(types).not.toContain("ce");
    expect(onceEl.once).toBe(true);
    host.remove();
  });
});
