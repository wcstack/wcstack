/**
 * 丸ごとマウント `data-wcs="state: path"`（ルート規則）の統合テスト。
 *
 * docs/state-mount-design.md §3-2（構文）/ §4-3（R1）、impl-plan Phase 1
 * （M1〜M7・M13〜M16・P1-11）。v1 機構（MappingRule / innerState）の上で成立させ、
 * Phase 2 の単一ツリー化はこのテストを緑に保つことで検証される（契約テスト）。
 *
 * 実モジュールだけで親スコープと子コンポーネントを組み立てる（単体テストは境界の
 * 片側しかモックできない）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { clearOwnKeyShadowReportsForTesting } from "../src/webComponent/ownKeyShadow";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

/** shadow 内に `<wcs-state bind-component="state">` と任意のマークアップを持つコンポーネント */
function defineComponent(tag: string, createState: () => Record<string, any>, innerTemplate: string): void {
  class Component extends HTMLElement {
    state: Record<string, any> = createState();
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      this.shadowRoot!.innerHTML = `<wcs-state bind-component="state"></wcs-state>${innerTemplate}`;
    }
  }
  customElements.define(tag, Component);
}

async function mountHost(json: string, body: string) {
  const host = document.createElement(uniqueTag("bcrm-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${body}`;
  document.body.appendChild(host);
  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  await flush();
  return { host, shadowRoot, parentStateElement };
}

async function childReady(component: Element): Promise<void> {
  const childShadow = component.shadowRoot!;
  const childStateElement = childShadow.querySelector("wcs-state") as State;
  await childStateElement.connectedCallbackPromise;
  await State.getBindingsReady(childShadow);
  await flush();
}

const shadowQuery = (host: Element, selector: string): Element =>
  host.shadowRoot!.querySelector(selector)!;

const text = (root: ParentNode, selector: string) => (root.querySelector(selector) as HTMLElement).textContent;

const CARD_TEMPLATE =
  `<span class="name" data-wcs="textContent: name"></span>` +
  `<span class="display" data-wcs="textContent: display"></span>`;

function cardState(): Record<string, any> {
  return {
    get display() { return `${this.name} <${this.email}>`; },
  };
}

async function mountCard(extraHostBind = "", extraJson = "") {
  const tag = uniqueTag("bcrm-card");
  defineComponent(tag, cardState, CARD_TEMPLATE + `<span class="theme" data-wcs="textContent: theme.mode"></span>`);
  const { host, shadowRoot, parentStateElement } = await mountHost(
    `{"user":{"name":"Alice","email":"a@x"},"theme":{"mode":"light"}${extraJson}}`,
    `<p id="host-name" data-wcs="textContent: user.name"></p><${tag} data-wcs="state: user${extraHostBind}"></${tag}>`,
  );
  const card = shadowRoot.querySelector(tag)!;
  await childReady(card);
  const cs = card.shadowRoot!;
  return { host, shadowRoot, parentStateElement, card, cs };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clearOwnKeyShadowReportsForTesting();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});
const shadowWarnings = () => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("[wcs/mount-own-key-shadow]"));

describe("bind-component: 丸ごとマウント state: path (integration)", () => {
  it("M1/M16: 中の name と getter がマウント先 user.* を読み、親の書き込みで再評価されること", async () => {
    const { host, shadowRoot, parentStateElement, cs } = await mountCard();

    expect(text(cs, ".name")).toBe("Alice");
    expect(text(cs, ".display")).toBe("Alice <a@x>");
    expect(text(cs, ".theme")).toBe("");

    parentStateElement.createState("writable", (s: any) => {
      s["user.name"] = "Carol";
    });
    await flush();
    await flush();

    expect(text(cs, ".name")).toBe("Carol");
    expect(text(cs, ".display")).toBe("Carol <a@x>");
    expect(text(shadowRoot, "#host-name")).toBe("Carol");
    expect(shadowWarnings()).toEqual([]);

    host.remove();
  });

  it("M2/M13: element.state 経由の書き込みがツリーに届き、親スコープのバインドが更新されること", async () => {
    const { host, shadowRoot, parentStateElement, card, cs } = await mountCard();

    (card as any).state.name = "Eve";
    await flush();
    await flush();

    expect(text(shadowRoot, "#host-name")).toBe("Eve");
    expect(text(cs, ".name")).toBe("Eve");
    expect(text(cs, ".display")).toBe("Eve <a@x>");
    expect((card as any).state.name).toBe("Eve");
    parentStateElement.createState("readonly", (s: any) => {
      expect(s["user.name"]).toBe("Eve");
    });

    host.remove();
  });

  it("M3: 親が user を丸ごと差し替えると中の全バインドが更新されること", async () => {
    const { host, parentStateElement, cs } = await mountCard();

    parentStateElement.createState("writable", (s: any) => {
      s.user = { name: "Dana", email: "d@x" };
    });
    await flush();
    await flush();

    expect(text(cs, ".name")).toBe("Dana");
    expect(text(cs, ".display")).toBe("Dana <d@x>");

    host.remove();
  });

  it("shadow 張り直しの連打では、剥がされた <wcs-state> がスコープを触らないこと", async () => {
    const { host, parentStateElement, card, cs } = await mountCard();
    const inner = card.shadowRoot!.querySelector("wcs-state")!.outerHTML.replace(/>.*/s, ">") +
      "</wcs-state>" + CARD_TEMPLATE + `<span class="theme" data-wcs="textContent: theme.mode"></span>`;

    // 同期で 2 回張り直す: 1 回目に入った <wcs-state> は初期化の await 中に剥がされ、
    // スコープを触らずに退場する（組み直すのは 2 回目に入ったもの）
    card.shadowRoot!.innerHTML = inner;
    card.shadowRoot!.innerHTML = inner;
    await childReady(card);
    await flush();
    await flush();

    expect(text(cs, ".name")).toBe("Alice");
    parentStateElement.createState("writable", (s: any) => {
      s["user.name"] = "Zoe";
    });
    await flush();
    await flush();
    expect(text(cs, ".name")).toBe("Zoe");

    host.remove();
  });

  it("M5: 部分マウント state.theme: theme を併用でき、部分規則が最長接頭辞で勝つこと", async () => {
    const { host, parentStateElement, cs } = await mountCard("; state.theme: theme");

    expect(text(cs, ".theme")).toBe("light");
    expect(text(cs, ".name")).toBe("Alice");

    parentStateElement.createState("writable", (s: any) => {
      s["theme.mode"] = "dark";
    });
    await flush();
    await flush();

    expect(text(cs, ".theme")).toBe("dark");

    host.remove();
  });
});

describe("bind-component: 行そのものをマウント state: . (integration)", () => {
  const ROW_TEMPLATE =
    `<span class="name" data-wcs="textContent: name"></span>` +
    `<ul class="tags"><template data-wcs="for: tags"><li data-wcs="textContent: .name"></li></template></ul>`;

  async function mountRows() {
    const tag = uniqueTag("bcrm-row");
    defineComponent(tag, () => ({}), ROW_TEMPLATE);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"users":[{"id":"a","name":"Anna","tags":[{"name":"x"}]},{"id":"b","name":"Ben","tags":[{"name":"y"},{"name":"z"}]}]}',
      `<div id="rows"><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`,
    );
    const rows = () => Array.from(shadowRoot.querySelectorAll(tag));
    const settle = async () => {
      await flush();
      await flush();
      for (const row of rows()) {
        await childReady(row);
      }
    };
    await settle();
    const names = () => rows().map((row) => text(row.shadowRoot!, ".name"));
    const tags = (i: number) => Array.from(rows()[i].shadowRoot!.querySelectorAll(".tags li")).map((li) => li.textContent);
    return { host, parentStateElement, rows, names, tags, settle };
  }

  it("M4/M7/M10: 各行が自分の行を読み、中の for が users.*.tags.* を回すこと", async () => {
    const { host, parentStateElement, names, tags, settle } = await mountRows();

    expect(names()).toEqual(["Anna", "Ben"]);
    expect(tags(0)).toEqual(["x"]);
    expect(tags(1)).toEqual(["y", "z"]);

    // M4: 行フィールドの書き込みはその行だけ
    parentStateElement.createState("writable", (s: any) => {
      s["users.1.name"] = "Bennett";
    });
    await settle();
    expect(names()).toEqual(["Anna", "Bennett"]);

    // M7: 行の配列の差し替えに中の for が追随する
    parentStateElement.createState("writable", (s: any) => {
      s["users.0.tags"] = [...s["users.0.tags"], { name: "w" }];
    });
    await settle();
    expect(tags(0)).toEqual(["x", "w"]);
    expect(tags(1)).toEqual(["y", "z"]);

    host.remove();
  });

  it("入れ子 for（for の中の for）を持つスコープでも変換が全段に効くこと", async () => {
    // フラグメント内の入れ子テンプレート参照（uuid エントリ）は変換を素通しし、
    // 実体化時に内側フラグメント自身の変換が掛かる（collectStructuralFragments の対称性）
    const tag = uniqueTag("bcrm-nest");
    defineComponent(tag, () => ({}),
      `<div class="groups"><template data-wcs="for: groups">` +
      `<ul><template data-wcs="for: groups.*.items">` +
      `<li data-wcs="textContent: groups.*.items.*.name"></li>` +
      `</template></ul></template></div>`);
    const { host, parentStateElement } = await mountHost(
      JSON.stringify({ box: { groups: [
        { items: [{ name: "a1" }, { name: "a2" }] },
        { items: [{ name: "b1" }] },
      ] } }),
      `<${tag} data-wcs="state: box"></${tag}>`,
    );
    const c = shadowQuery(host, tag);
    await childReady(c);
    const texts = () => Array.from(c.shadowRoot!.querySelectorAll("li")).map((li) => li.textContent);

    expect(texts()).toEqual(["a1", "a2", "b1"]);

    parentStateElement.createState("writable", (s: any) => {
      s["box.groups.1.items"] = [{ name: "b1" }, { name: "b2" }];
    });
    await flush();
    await flush();
    expect(texts()).toEqual(["a1", "a2", "b1", "b2"]);

    host.remove();
  });

  it("M17: swap と丸ごと差し替えで行コンポーネントが付け替わること", async () => {
    const { host, parentStateElement, rows, names, tags, settle } = await mountRows();

    parentStateElement.createState("writable", (s: any) => {
      s.users = [s.users[1], s.users[0]];
    });
    await settle();
    expect(names()).toEqual(["Ben", "Anna"]);
    expect(tags(0)).toEqual(["y", "z"]);

    parentStateElement.createState("writable", (s: any) => {
      s.users = [{ id: "c", name: "Cleo", tags: [{ name: "c1" }] }];
    });
    await settle();
    expect(rows()).toHaveLength(1);
    expect(names()).toEqual(["Cleo"]);
    expect(tags(0)).toEqual(["c1"]);

    // 差し替え後も行フィールドの書き込みが届く（§1.9 の形）
    parentStateElement.createState("writable", (s: any) => {
      s["users.0.name"] = "Cleopatra";
    });
    await settle();
    expect(names()).toEqual(["Cleopatra"]);

    host.remove();
  });

  it("M17b: shadow を一度だけ組むコンポーネントは、再接続で台帳を張り直して行に追随すること（remount 経路）", async () => {
    // M17 の wipe 型（connectedCallback のたびに innerHTML を張り直す）はスコープを
    // 組み直す再初期化経路に乗る。こちらは shadow を一度だけ組む形 — 同じ <wcs-state> が
    // 再接続され、remountScopeBindings / rebindAddresses（lastListValue の引き継ぎ込み）が走る
    const tag = uniqueTag("bcrm-once");
    class RowOnce extends HTMLElement {
      state: Record<string, any> = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
      connectedCallback() {
        if (this.shadowRoot!.firstChild === null) {
          this.shadowRoot!.innerHTML = `<wcs-state bind-component="state"></wcs-state>${ROW_TEMPLATE}`;
        }
      }
    }
    customElements.define(tag, RowOnce);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"users":[{"id":"a","name":"Anna","tags":[{"name":"x"}]},{"id":"b","name":"Ben","tags":[{"name":"y"},{"name":"z"}]}]}',
      `<div id="rows"><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`,
    );
    const rows = () => Array.from(shadowRoot.querySelectorAll(tag));
    const settle = async () => {
      await flush();
      await flush();
      for (const row of rows()) {
        await childReady(row);
      }
    };
    await settle();
    const names = () => rows().map((row) => text(row.shadowRoot!, ".name"));
    const tags = (i: number) => Array.from(rows()[i].shadowRoot!.querySelectorAll(".tags li")).map((li) => li.textContent);

    expect(names()).toEqual(["Anna", "Ben"]);

    parentStateElement.createState("writable", (s: any) => {
      s.users = [s.users[1], s.users[0]];
    });
    await settle();
    expect(names()).toEqual(["Ben", "Anna"]);
    expect(tags(0)).toEqual(["y", "z"]);
    expect(tags(1)).toEqual(["x"]);

    parentStateElement.createState("writable", (s: any) => {
      s.users = [{ id: "c", name: "Cleo", tags: [{ name: "c1" }] }];
    });
    await settle();
    expect(rows()).toHaveLength(1);
    expect(names()).toEqual(["Cleo"]);
    expect(tags(0)).toEqual(["c1"]);

    parentStateElement.createState("writable", (s: any) => {
      s["users.0.name"] = "Cleopatra";
    });
    await settle();
    expect(names()).toEqual(["Cleopatra"]);

    host.remove();
  });
});

describe("bind-component: R1 — own data key は私有 (integration)", () => {
  it("M14: own data key はツリーに載らず、要素ごとに独立であること", async () => {
    const tag = uniqueTag("bcrm-priv");
    // 値は文字列にする（happy-dom は textContent = false を "" にするため）
    defineComponent(tag, () => ({ mode: "view" }),
      `<span class="name" data-wcs="textContent: name"></span><span class="mode" data-wcs="textContent: mode"></span>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} id="a" data-wcs="state: user"></${tag}><${tag} id="b" data-wcs="state: user"></${tag}>`,
    );
    const a = shadowRoot.querySelector("#a")!;
    const b = shadowRoot.querySelector("#b")!;
    await childReady(a);
    await childReady(b);

    expect(text(a.shadowRoot!, ".name")).toBe("Alice");
    expect(text(a.shadowRoot!, ".mode")).toBe("view");

    (a as any).state.mode = "edit";
    await flush();
    await flush();

    expect(text(a.shadowRoot!, ".mode")).toBe("edit");
    expect(text(b.shadowRoot!, ".mode")).toBe("view");
    expect((a as any).state.mode).toBe("edit");
    parentStateElement.createState("readonly", (s: any) => {
      expect("mode" in s.user).toBe(false);
    });
    // マウント先に無いキーは正当な私有なので警告しない
    expect(shadowWarnings()).toEqual([]);

    host.remove();
  });

  it("M15: own data key がマウント先の同名キーを隠すときは console.warn が 1 回出ること", async () => {
    const tag = uniqueTag("bcrm-shadow");
    defineComponent(tag, () => ({ name: "" }), `<span class="name" data-wcs="textContent: name"></span>`);
    const { host, shadowRoot } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} id="a" data-wcs="state: user"></${tag}><${tag} id="b" data-wcs="state: user"></${tag}>`,
    );
    const a = shadowRoot.querySelector("#a")!;
    await childReady(a);
    await childReady(shadowRoot.querySelector("#b")!);

    // R1: 私有がツリーを隠す（既定値 "" が読まれる）
    expect(text(a.shadowRoot!, ".name")).toBe("");
    const warnings = shadowWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`<${tag}>.state.name`);
    expect(warnings[0]).toContain('"user.name"');

    host.remove();
  });

  it("P1-11 の反転（D19）: 部分マウントでも作者の own data key が私有として勝ち、警告が出ること", async () => {
    // 1.x では「ホストが勝つ」＋反転予告の警告だった（Phase 1 の P1-11）。
    // v2 は厳格 R1: 作者の既定値 { message: "" } が私有になりマッピングを隠す
    const tag = uniqueTag("bcrm-partial");
    defineComponent(tag, () => ({ message: "own-default" }), `<span class="msg" data-wcs="textContent: message"></span>`);
    const { host, shadowRoot } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} data-wcs="state.message: user.name"></${tag}>`,
    );
    const c = shadowRoot.querySelector(tag)!;
    await childReady(c);

    expect(text(c.shadowRoot!, ".msg")).toBe("own-default");
    const warnings = shadowWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('hides the mounted entry "state.message: user.name"');

    host.remove();
  });
});

/**
 * イベントハンドラの添字スコープ（§4-4 / P2-9）— Δ=0 の丸ごとマウントと同名翻訳。
 *
 * 翻訳でワイルドカードが増えないマウント（`state: user` の Δ=0、`state.items: items`
 * の同名翻訳）でも、自スコープの `for` の添字は作者に見えなければならない。
 * indexShiftByLoopElementPath への登録が「translated !== parsed && shift > 0」に
 * 限られていた間は台帳ミスが「借用行＝添字 0 本」と解釈され、クリック添字が空に
 * なっていた（v2 レビューの修理 — mount.ts translateParsedForMount）。
 */
describe("bind-component: Δ=0 マウントのイベント添字はスコープ相対", () => {
  it("丸ごとマウント（state: user・Δ=0）の内側 for のハンドラに行添字が届くこと", async () => {
    const tag = uniqueTag("bcrm-evt-delta0");
    const calls: number[][] = [];
    defineComponent(tag, () => ({
      pick(_e: Event, ...idx: number[]) { calls.push(idx); },
    }), `<template data-wcs="for: items"><button data-wcs="onclick: pick"></button></template>`);
    const { host, shadowRoot } = await mountHost(
      '{"user":{"items":["x","y"]}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag)!;
    await childReady(component);

    const buttons = component.shadowRoot!.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    (buttons[1] as HTMLElement).dispatchEvent(new Event("click"));
    await flush();
    await flush();

    expect(calls).toEqual([[1]]);
    host.remove();
  });

  it("同名翻訳の部分マウント（state.items: items）の内側 for のハンドラにも行添字が届くこと", async () => {
    const tag = uniqueTag("bcrm-evt-same");
    const calls: number[][] = [];
    defineComponent(tag, () => ({
      pick(_e: Event, ...idx: number[]) { calls.push(idx); },
    }), `<template data-wcs="for: items"><button data-wcs="onclick: pick"></button></template>`);
    const { host, shadowRoot } = await mountHost(
      '{"items":["x","y"]}',
      `<${tag} data-wcs="state.items: items"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag)!;
    await childReady(component);

    const buttons = component.shadowRoot!.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    (buttons[1] as HTMLElement).dispatchEvent(new Event("click"));
    await flush();
    await flush();

    expect(calls).toEqual([[1]]);
    host.remove();
  });
});

/**
 * v2 設定エラーの fail-fast 規範（レビュー修理）: _initializeBindWebComponent 内の
 * raise は initializePromise / connectedCallbackPromise を解決してから伝播すること。
 * 未解決のまま投げると waitForStateInitialize がページ全体を無言でウェッジする
 * （_failInitialization の注記と同じ理由）。既存イディオムに合わせ、非接続のまま
 * 直接呼んで rejection を捕まえる（DOM 駆動だと unhandled rejection になるため）。
 */
describe("bind-component: v2 設定エラーの fail-fast（初期化待ちをウェッジさせない）", () => {
  it("2 本目の bind-component（別 prop）の raise でも初期化待ちが解決すること", async () => {
    const { setStateElement } = await import("../src/stateElementByName");
    const { host, shadowRoot, parentStateElement, card, cs } = await mountCard("; extra: theme");
    // 自動 connect を避けるため一旦 document から外し、ルート登録と親の rootNode だけ
    // 手で戻す（「親は生きているが 2 本目が来た」形をテスト都合で再現する）
    host.remove();
    setStateElement(shadowRoot, parentStateElement);
    (parentStateElement as any)._rootNode = shadowRoot;
    try {
      const second = document.createElement("wcs-state") as State;
      second.setAttribute("bind-component", "extra");
      cs.appendChild(second); // 非接続なので connectedCallback は走らない

      await expect((second as any)._initializeBindWebComponent())
        .rejects.toThrow(/one <wcs-state bind-component> per component/);
      // fail-fast でも初期化待ちはウェッジしない（旧挙動: 未解決 throw で永久待ち）
      await second.initializePromise;
      await second.connectedCallbackPromise;
      expect(card).toBeTruthy();
    } finally {
      (parentStateElement as any)._rootNode = null;
      setStateElement(shadowRoot, null);
    }
  });

  it("親ツリーの居ないルートでのマウント再初期化の raise でも初期化待ちが解決すること", async () => {
    const { host, card, cs } = await mountCard();
    // ルート state 要素ごと外れた形（登録解除・binding 台帳とマウント記録は残る）
    host.remove();
    const replacement = document.createElement("wcs-state") as State;
    replacement.setAttribute("bind-component", "state");
    cs.appendChild(replacement); // 非接続なので connectedCallback は走らない

    await expect((replacement as any)._initializeBindWebComponent())
      .rejects.toThrow(/No state tree found on this root for mount host/);
    // fail-fast でも初期化待ちはウェッジしない
    await replacement.initializePromise;
    await replacement.connectedCallbackPromise;
    expect(card).toBeTruthy();
  });
});
