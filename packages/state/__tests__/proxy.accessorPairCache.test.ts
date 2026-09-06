/**
 * proxy.accessorPairCache.test.ts — アクセサペア（get/set 同名パス）への書き込みと
 * getter キャッシュの整合（Issue #234）。
 *
 * setByAddress は書き込み後にキャッシュ可能パスへ代入値を dirty:false で載せていた。
 * アクセサペアではこれが「getter の評価結果」として固定され、
 * - getter が一度も評価されない → 動的依存が張られない
 * - 依存先を書いても walkDependency がこのキャッシュを dirty にできない
 * という永続的な stale を作っていた。プリミティブ代入は同値ガードの旧値読みで
 * getter が偶然評価されるため動いていたが、オブジェクト代入は同値ガードを素通りする。
 *
 * 修正後: アクセサペアへの書き込みはキャッシュを dirty にし、次回の読みで getter を
 * 再評価させる（getter が正本）。ワイルドカードのデータパスは従来どおり代入値をキャッシュする。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`accessor-pair-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  return { host, shadowRoot, stateElement };
}

describe("アクセサペアへの書き込みと getter キャッシュ（Issue #234）", () => {
  it("オブジェクトを代入しても getter が再評価され、依存先の変更が反映されること", async () => {
    let getterCalls = 0;
    const { host, shadowRoot, stateElement } = await mount(
      {
        name: "",
        get snapshot(this: any) { getterCalls++; return { name: this.name }; },
        set snapshot(this: any, v: any) { this.name = v?.name ?? ""; },
      },
      `<span id="out" data-wcs="textContent: name"></span>`,
    );
    const read = () => {
      let out: any;
      stateElement.createState("readonly", (s: any) => { out = { name: s.name, snapshot: s.snapshot.name }; });
      return out;
    };

    // 1. オブジェクトを setter 経由で代入（同値ガードを素通りする形）
    stateElement.createState("writable", (s: any) => { s.snapshot = { name: "alice" }; });
    await flush();
    expect(read()).toEqual({ name: "alice", snapshot: "alice" });
    expect(getterCalls).toBeGreaterThanOrEqual(1);
    // getter が評価されたので name → snapshot の依存が登録されている
    expect(stateElement.dynamicDependency.get("name") ?? []).toContain("snapshot");

    // 2. getter の依存先を変更 → snapshot も追随する
    stateElement.createState("writable", (s: any) => { s.name = "bob"; });
    await flush();
    expect(shadowRoot.querySelector("#out")!.textContent).toBe("bob");
    expect(read()).toEqual({ name: "bob", snapshot: "bob" });
    host.remove();
  });

  it("代入直後の読みは代入値ではなく getter の評価結果を返すこと（setter が正規化する形）", async () => {
    const { host, stateElement } = await mount(
      {
        _title: "",
        get title(this: any) { return this._title; },
        set title(this: any, v: string) { this._title = String(v).trim().toUpperCase(); },
      },
      `<span data-wcs="textContent: title"></span>`,
    );
    stateElement.createState("writable", (s: any) => { s.title = "  hello  "; });
    let title: unknown;
    stateElement.createState("readonly", (s: any) => { title = s.title; });
    expect(title).toBe("HELLO");
    host.remove();
  });

  it("バインドされたアクセサペアへのオブジェクト代入後、依存先の変更が DOM に反映されること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        name: "",
        get snapshot(this: any) { return { name: this.name }; },
        set snapshot(this: any, v: any) { this.name = v?.name ?? ""; },
      },
      `<span id="snap" data-wcs="textContent: snapshot.name"></span>`,
    );
    stateElement.createState("writable", (s: any) => { s.snapshot = { name: "alice" }; });
    await flush();
    expect(shadowRoot.querySelector("#snap")!.textContent).toBe("alice");
    stateElement.createState("writable", (s: any) => { s.name = "bob"; });
    await flush();
    expect(shadowRoot.querySelector("#snap")!.textContent).toBe("bob");
    host.remove();
  });

  it("ワイルドカードのデータパスへの書き込みは従来どおり代入値がキャッシュされ、読みに反映されること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ v: 1 }, { v: 2 }] },
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*.v"></li></template></ul>`,
    );
    stateElement.createState("writable", (s: any) => {
      s.$setAll("items.*.v", [], [10, 20], { spread: true });
    });
    await flush();
    const texts = Array.from(shadowRoot.querySelectorAll("li")).map((li) => li.textContent);
    expect(texts).toEqual(["10", "20"]);
    host.remove();
  });
});
