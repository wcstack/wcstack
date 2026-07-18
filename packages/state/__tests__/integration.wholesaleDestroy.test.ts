/**
 * integration.wholesaleDestroy.test.ts — clear（全行削除）でプール超過分の
 * content が wholesale destroy（teardown 省略・GC 任せ）されるエンドツーエンド契約。
 *
 * - プール超過分を wholesale 破棄しても DOM・再描画・イベント配線が正しく保たれる
 * - ネストしたリストを含む行も再帰的に破棄される
 * - 定義待ち等で wholesale できない content は従来経路で解体される（フォールバック）
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";
import { __test_setMaxPooledContents } from "../src/apply/applyChangeToFor";
import { getBindingSessionByContent } from "../src/bindings/bindingSessionByContent";
import { getContentSetByNode } from "../src/structural/contentsByNode";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
let restoreCap: number | null = null;
const flush = () => new Promise((r) => setTimeout(r));

afterEach(() => {
  if (restoreCap !== null) {
    __test_setMaxPooledContents(restoreCap);
    restoreCap = null;
  }
});

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`wsd-host-${seq++}`);
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

describe("clear の wholesale destroy（統合）", () => {
  it("プール超過分を wholesale 破棄しても clear → 再生成 → イベントが正しく動くこと", async () => {
    restoreCap = __test_setMaxPooledContents(2);
    let clicked: number[] = [];
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }],
        onPick(this: any, _e: Event, $1: number) { clicked.push($1); },
      },
      `<ul><template data-wcs="for: items"><li><a data-wcs="onclick: onPick">{{ .v }}</a></li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("li")).map(li => li.textContent);
    expect(texts()).toEqual(["1", "2", "3", "4", "5"]);

    stateElement.createState("writable", (s: any) => { s.items = []; });
    await flush();
    expect(texts()).toEqual([]);

    // 再生成: プール 2 件 + 新規 3 件。描画・イベント配線とも正しいこと
    stateElement.createState("writable", (s: any) => {
      s.items = [{ v: 10 }, { v: 20 }, { v: 30 }, { v: 40 }, { v: 50 }];
    });
    await flush();
    expect(texts()).toEqual(["10", "20", "30", "40", "50"]);

    clicked = [];
    (shadowRoot.querySelectorAll("li a")[3] as HTMLElement).click();
    await flush();
    expect(clicked).toEqual([3]);
    host.remove();
  });

  it("ネストしたリストを含む行も wholesale 破棄で正しくクリア・再生成できること", async () => {
    restoreCap = __test_setMaxPooledContents(0);
    const { host, shadowRoot, stateElement } = await mount(
      {
        groups: [
          { name: "g1", members: [{ n: "a" }, { n: "b" }] },
          { name: "g2", members: [{ n: "c" }] },
        ],
      },
      `<div><template data-wcs="for: groups"><section><h2>{{ .name }}</h2><ul><template data-wcs="for: .members"><li>{{ .n }}</li></template></ul></section></template></div>`,
    );
    const names = () => Array.from(shadowRoot.querySelectorAll("h2")).map(el => el.textContent);
    const members = () => Array.from(shadowRoot.querySelectorAll("li")).map(el => el.textContent);
    expect(names()).toEqual(["g1", "g2"]);
    expect(members()).toEqual(["a", "b", "c"]);

    stateElement.createState("writable", (s: any) => { s.groups = []; });
    await flush();
    expect(names()).toEqual([]);
    expect(members()).toEqual([]);

    stateElement.createState("writable", (s: any) => {
      s.groups = [{ name: "g3", members: [{ n: "x" }, { n: "y" }] }];
    });
    await flush();
    expect(names()).toEqual(["g3"]);
    expect(members()).toEqual(["x", "y"]);
    host.remove();
  });

  it("wholesale できない content（deferred タスク持ち）は従来経路で解体されること", async () => {
    restoreCap = __test_setMaxPooledContents(0);
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ v: 1 }, { v: 2 }] },
      `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`,
    );
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(2);

    // 1 行分の session に擬似 deferred タスクを注入し、tryDestroy を不許可にする
    const anchor = Array.from(shadowRoot.querySelector("ul")!.childNodes)
      .find(n => n.nodeType === Node.COMMENT_NODE)!;
    const contents = Array.from(getContentSetByNode(anchor));
    expect(contents.length).toBeGreaterThan(0);
    const session = getBindingSessionByContent(contents[0])!;
    const task = { node: document.createElement("div"), active: true, cancel: null };
    (session as any).deferred.add(task);

    stateElement.createState("writable", (s: any) => { s.items = []; });
    await flush();
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(0);
    // フォールバック（unmount 経由の session.dispose）で deferred も掃除される
    expect((session as any).deferred.size).toBe(0);
    host.remove();
  });
});
