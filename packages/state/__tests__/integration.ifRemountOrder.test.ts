/**
 * integration.ifRemountOrder.test.ts — if 再適用時のコンテンツノード順の保存契約。
 *
 * if: バインディングは条件値が true のまま依存値が変わっても再適用される
 * (applyChangeToIf に前回値ガードは無く、マウント済み content へ mountAfter が
 * 再突入する)。かつて mountAfter は構築時捕捉の nextSibling へ一括 insertBefore
 * していたため、再突入のたびに先頭ノードが末尾へ回転した(ToDo アプリで
 * 追加のたびに toolbar が上下に移動する実バグ)。ここでは複数トップレベル
 * ノード(空白テキスト込み)の順序が再適用を跨いで不変であることを固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`ifremount-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  return { host, shadowRoot, stateElement };
}

describe("if 再適用時のコンテンツノード順(統合)", () => {
  it("条件が true のまま依存値が変わり続けても、トップレベルノード順が保たれること", async () => {
    // ToDo アプリと同型: 空白テキストを挟んだ toolbar / list / footer の 3 要素。
    // 旧実装では追加 2 回目以降に先頭ノードが末尾へ回転し toolbar が移動した。
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [] as { v: number }[],
        get total(this: any) {
          return Array.isArray(this.items) ? this.items.length : 0;
        },
      },
      `<div id="wrap">
        <template data-wcs="if: total|gt(0)">
          <div class="toolbar">T</div>
          <ul class="list"><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>
          <footer class="foot">F</footer>
        </template>
        <template data-wcs="else:"><p class="empty">empty</p></template>
      </div>`,
    );
    const wrap = shadowRoot.querySelector("#wrap")!;
    const order = () => Array.from(wrap.children).map((el) => el.className);
    const liTexts = () => Array.from(wrap.querySelectorAll("li")).map((li) => li.textContent);

    expect(order()).toEqual(["empty"]);

    const add = async (v: number) => {
      stateElement.createState("writable", (s: any) => {
        s.items = [...s.items, { v }];
      });
      await flush();
    };

    await add(1); // false→true の初回マウント
    expect(order()).toEqual(["toolbar", "list", "foot"]);
    expect(liTexts()).toEqual(["1"]);

    // true のまま再適用が続いても回転しない(周期 7 の回転を跨ぐ 8 回まで確認)
    for (let v = 2; v <= 8; v++) {
      await add(v);
      expect(order()).toEqual(["toolbar", "list", "foot"]);
    }
    expect(liTexts()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);

    host.remove();
  });

  it("false のまま再適用される else コンテンツも、トップレベルノード順が保たれること", async () => {
    // if が false のまま依存値が変わると else 側が true→true で再適用される。
    const { host, shadowRoot, stateElement } = await mount(
      { count: 1 },
      `<div id="wrap">
        <template data-wcs="if: count|gt(10)"><p class="over">over</p></template>
        <template data-wcs="else:">
          <span class="a">A</span>
          <span class="b">B</span>
          <span class="c">C</span>
        </template>
      </div>`,
    );
    const wrap = shadowRoot.querySelector("#wrap")!;
    const order = () => Array.from(wrap.children).map((el) => el.className);

    expect(order()).toEqual(["a", "b", "c"]);

    for (let n = 2; n <= 8; n++) {
      stateElement.createState("writable", (s: any) => {
        s.count = n;
      });
      await flush();
      expect(order()).toEqual(["a", "b", "c"]);
    }

    host.remove();
  });

  it("条件のトグルを繰り返しても正しくマウント/アンマウントされ順序が保たれること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { visible: false },
      `<div id="wrap">
        <template data-wcs="if: visible">
          <div class="x">X</div>
          <div class="y">Y</div>
        </template>
        <template data-wcs="else:"><p class="off">off</p></template>
      </div>`,
    );
    const wrap = shadowRoot.querySelector("#wrap")!;
    const order = () => Array.from(wrap.children).map((el) => el.className);

    expect(order()).toEqual(["off"]);

    for (let i = 0; i < 3; i++) {
      stateElement.createState("writable", (s: any) => {
        s.visible = true;
      });
      await flush();
      expect(order()).toEqual(["x", "y"]);

      stateElement.createState("writable", (s: any) => {
        s.visible = false;
      });
      await flush();
      expect(order()).toEqual(["off"]);
    }

    host.remove();
  });
});
