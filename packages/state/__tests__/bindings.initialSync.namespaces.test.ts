/**
 * bindings.initialSync.namespaces.test.ts — 左辺の名前空間の集合が apply 層と一致すること。
 *
 * `resolveInitialSyncPolicy` は「左辺が名前空間の束縛」を wcBindable のプロパティ検証から
 * 除外する。かつて除外されていたのは `command.` **だけ**で、`class.` / `attr.` / `style.` は
 * 素通りして `Property "class.on" is not declared by wcBindable.` に落ちていた。これは
 * throw なので、wc-bindable 要素に `class.on: flag` を 1 つ足しただけで**そのルートの
 * 束縛が 1 つも立たなくなる**（`getBindingsReady` ごと reject）。
 *
 * 三面のうちランタイムだけがズレていた形（vscode-wcs の ioNodeValidator と
 * `apply/applyChange.ts` は 4 名前空間を対等に扱っている）なので、集合の一致を
 * apply 層のディスパッチ表と突き合わせて構造的に固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getConfig, setConfig } from "../src/config";
import { applyChangeByFirstSegment } from "../src/apply/applyChange";
import { resolveInitialSyncPolicy } from "../src/bindings/initialSync";
import { getPathInfo } from "../src/address/PathInfo";
import type { IBindingInfo } from "../src/types";
import type { IWcBindable } from "../src/event/types";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let seq = 0;

class NsProbe extends HTMLElement {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [{ name: "value", event: "ns-probe:value-changed" }],
    inputs: [{ name: "value" }],
  };
  value = "";
}
customElements.define("ns-probe-el", NsProbe);

function bindingOf(node: Element, propName: string): IBindingInfo {
  return {
    propName,
    propSegments: propName.split("."),
    propModifiers: [],
    statePathName: "flag",
    statePathInfo: getPathInfo("flag"),
    inFilters: [],
    outFilters: [],
    bindingType: "prop",
    uuid: null,
    node,
    replaceNode: node,
  } as unknown as IBindingInfo;
}

describe("左辺の名前空間は wcBindable のプロパティ検証に掛けないこと", () => {
  it("apply 層のディスパッチ表と同じ集合であること（drift 検出）", () => {
    // `applyChangeByFirstSegment` のキーが左辺名前空間の正本。initialSync 側が
    // 1 つでも取りこぼすと、その名前空間で束縛が全滅する
    const element = document.createElement("ns-probe-el");
    const previous = getConfig().enableDirectionalInitialSync;
    setConfig({ enableDirectionalInitialSync: true });
    try {
      for (const namespace of Object.keys(applyChangeByFirstSegment)) {
        expect(() => resolveInitialSyncPolicy(bindingOf(element, `${namespace}.on`)), namespace).not.toThrow();
      }
      // 名前空間でない未宣言プロパティは従来どおり落ちる（除外を広げすぎていないこと）
      expect(() => resolveInitialSyncPolicy(bindingOf(element, "nosuch"))).toThrow(/not declared by wcBindable/);
    } finally {
      setConfig({ enableDirectionalInitialSync: previous });
    }
  });

  it.each([
    ["class.on", "flag"],
    ["attr.title", "v"],
    ["style.color", "v"],
    // command. は 3.x 以前から除外されていた側。対照として並べる
    ["command.go", "$command.go"],
  ])(
    "wc-bindable 要素に %s を足してもルートの束縛が立つこと（統合）",
    async (leftHand, rightHand) => {
      const host = document.createElement(`ns-host-${++seq}`);
      const shadowRoot = host.attachShadow({ mode: "open" });
      shadowRoot.innerHTML =
        `<ns-probe-el data-wcs="value: v; ${leftHand}: ${rightHand}"></ns-probe-el>` +
        `<p data-wcs="textContent: v"></p><wcs-state></wcs-state>`;
      document.body.appendChild(host);
      const stateEl = shadowRoot.querySelector("wcs-state") as State;
      stateEl.setInitialState({ v: "ok", flag: true, $commandTokens: ["go"] });
      await stateEl.connectedCallbackPromise;
      await expect(State.getBindingsReady(shadowRoot)).resolves.not.toThrow();
      await flush();
      // 同じルートの無関係なバインディングが生きていること（全滅していない証拠）
      expect(shadowRoot.querySelector("p")!.textContent).toBe("ok");
      host.remove();
    },
  );
});
