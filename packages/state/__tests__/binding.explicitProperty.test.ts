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

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

class ExStatus extends HTMLElement {
  online = false;
  only = "";
}
customElements.define("ex-explicit-status", ExStatus);

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

  it.each([".: x", "..online: x", ".online.: x", ".class.on: x", ".attr.title: x", ".style.color: x", ".command.go: x", ".eventToken.done: x"])(
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
