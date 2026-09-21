/**
 * bindings.rowSession.test.ts — 行 record ＋ リストごとの共有 session（行ランタイム設計 R3）の境界。
 *
 * プラン行の帳簿は、束縛ごとの record ではなく**行ごとの record**（slot 配列）になり、その行は
 * `for` 束縛ごとに 1 つの `BindingSession` が Set で持つ。行の生成・使い回し・解体・消去・
 * プール再利用・切断・再セットが、行単位で閉じている（同じリストの生きている行を巻き込まない）
 * ことをここで固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { getBindingsByContent } from "../src/bindings/bindingsByContent";
import { getBindingSessionByContent } from "../src/bindings/bindingSessionByContent";
import { getContentSetByNode } from "../src/structural/contentsByNode";

/** `for` の実体化位置を指すコメント（template はコメントへ置き換わる）。文書順で返す */
function forPlaceholders(root: ParentNode): Comment[] {
  const walker = document.createTreeWalker(root as unknown as Node, NodeFilter.SHOW_COMMENT);
  const found: Comment[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if ((node as Comment).data.startsWith("@@wcs-for")) found.push(node as Comment);
  }
  return found;
}

const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve));

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
async function mount(initial: any, innerHTML: string): Promise<{ host: HTMLElement; shadowRoot: ShadowRoot; stateEl: State }> {
  const host = document.createElement(`row-session-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await (stateEl.constructor as typeof State).getBindingsReady(shadowRoot);
  return { host, shadowRoot, stateEl };
}

const texts = (root: ParentNode, selector: string): (string | null)[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent);

const write = (stateEl: State, fn: (state: any) => void): void => {
  stateEl.createState("writable", fn as any);
};

const LIST = `<ul><template data-wcs="for: items"><li class="row" data-wcs="textContent: items.*.name"></li></template></ul>`;

describe("行 session — 行単位の帳簿", () => {
  it("1 つの `for` の全行が 1 つの session を共有すること", async () => {
    const { shadowRoot } = await mount({ items: [{ name: "a" }, { name: "b" }, { name: "c" }] }, LIST);
    const placeholder = forPlaceholders(shadowRoot)[0];
    const contents = Array.from(getContentSetByNode(placeholder));
    expect(contents.length).toBe(3);
    const sessions = new Set(contents.map((content) => getBindingSessionByContent(content)));
    expect(sessions.size).toBe(1);
    expect([...sessions][0]!.isRowSession).toBe(true);
  });

  it("行の使い回し（並べ替え）で、生きている他の行が巻き込まれないこと", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }, { name: "c" }],
    }, LIST);
    expect(texts(shadowRoot, ".row")).toEqual(["a", "b", "c"]);

    write(stateEl, (state) => { state.items = [{ name: "c" }, { name: "a" }, { name: "b" }]; });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual(["c", "a", "b"]);

    // 使い回した行への書き込みが、その行にだけ届く
    write(stateEl, (state) => { state.$resolve("items.*.name", [1], "A"); });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual(["c", "A", "b"]);
  });

  it("一部の行だけを消しても、残りの行が生きていること", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }, { name: "c" }],
    }, LIST);

    write(stateEl, (state) => { state.items = [{ name: "b" }]; });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual(["b"]);

    write(stateEl, (state) => { state.$resolve("items.*.name", [0], "B"); });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual(["B"]);
  });

  it("全消去のあとに作り直すと、プールの行が生き返って描けること", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }, { name: "c" }],
    }, LIST);

    write(stateEl, (state) => { state.items = []; });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual([]);

    write(stateEl, (state) => { state.items = [{ name: "x" }, { name: "y" }]; });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual(["x", "y"]);

    write(stateEl, (state) => { state.$resolve("items.*.name", [1], "Y"); });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual(["x", "Y"]);
  });

  it("2 つのリストは別々の session を持ち、互いの行に触れないこと", async () => {
    const { shadowRoot, stateEl } = await mount({
      left: [{ name: "l1" }],
      right: [{ name: "r1" }, { name: "r2" }],
    }, `<ul class="left"><template data-wcs="for: left"><li class="l" data-wcs="textContent: left.*.name"></li></template></ul>` +
       `<ul class="right"><template data-wcs="for: right"><li class="r" data-wcs="textContent: right.*.name"></li></template></ul>`);

    const [leftPlaceholder, rightPlaceholder] = forPlaceholders(shadowRoot);
    const sessionsLeft = new Set(Array.from(getContentSetByNode(leftPlaceholder)).map(getBindingSessionByContent));
    const sessionsRight = new Set(Array.from(getContentSetByNode(rightPlaceholder)).map(getBindingSessionByContent));
    expect(sessionsLeft.size).toBe(1);
    expect(sessionsRight.size).toBe(1);
    expect([...sessionsLeft][0]).not.toBe([...sessionsRight][0]);

    write(stateEl, (state) => { state.right = []; });
    await flush();
    expect(texts(shadowRoot, ".l")).toEqual(["l1"]);
    expect(texts(shadowRoot, ".r")).toEqual([]);
  });

  it("行の中のイベント束縛が、行の解体で外れること", async () => {
    const clicks: string[] = [];
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }],
      pick(this: any, event: Event, index: number) { clicks.push(String(this.$resolve("items.*.name", [index]))); },
    }, `<ul><template data-wcs="for: items"><li class="row" data-wcs="textContent: items.*.name; onclick: pick"></li></template></ul>`);

    const rows = () => Array.from(shadowRoot.querySelectorAll<HTMLElement>(".row"));
    rows()[0].click();
    await flush();
    expect(clicks).toEqual(["a"]);

    write(stateEl, (state) => { state.items = [{ name: "a" }]; });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual(["a"]);

    // 残った行のハンドラは生きている（行の解体が同じ session の他の行を巻き込まない）
    rows()[0].click();
    await flush();
    expect(clicks).toEqual(["a", "a"]);
  });

  it("切断しても行は生きたまま（再接続で戻る）で、session ごと dispose すると全行が解体されること", async () => {
    const { host, shadowRoot } = await mount({
      items: [{ name: "a" }, { name: "b" }],
    }, LIST);
    const content = Array.from(getContentSetByNode(forPlaceholders(shadowRoot)[0]))[0];
    const session = getBindingSessionByContent(content)!;
    const binding = getBindingsByContent(content)[0];
    expect(session.shouldApplyState(binding)).toBe(true);

    const activeNodes = (): Node[] => {
      const nodes: Node[] = [];
      session.forEachActiveBindingNode((node) => nodes.push(node));
      return nodes;
    };
    expect(activeNodes().length).toBe(2);

    // 切断は行を解体しない: 付け直したときに同じ木へ戻すのが契約（State の再接続）
    host.remove();
    await flush();
    expect(activeNodes().length).toBe(2);

    // session ごとの dispose は、持っている行を全部解体する
    session.dispose();
    expect(activeNodes()).toEqual([]);
  });

  it("select の遅延適用（行の teardown を登録する経路）が働くこと", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ choice: "b" }, { choice: "a" }],
    }, `<template data-wcs="for: items"><select class="pick" data-wcs="value: items.*.choice"><option value="a">a</option><option value="b">b</option></select></template>`);

    const values = (): string[] => Array.from(shadowRoot.querySelectorAll<HTMLSelectElement>(".pick")).map((el) => el.value);
    expect(values()).toEqual(["b", "a"]);

    // 行を捨てる（登録済みの teardown を持つ行の解体）
    write(stateEl, (state) => { state.items = [{ choice: "a" }]; });
    await flush();
    expect(values()).toEqual(["a"]);
  });

  it("`_state` を入れ直すと、新しい世代の行として描き直されること", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }],
    }, LIST);

    stateEl.setInitialState({ items: [{ name: "p" }, { name: "q" }, { name: "r" }] });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual(["p", "q", "r"]);

    write(stateEl, (state) => { state.$resolve("items.*.name", [2], "R"); });
    await flush();
    expect(texts(shadowRoot, ".row")).toEqual(["p", "q", "R"]);
  });
});

/**
 * プランに載らない行（双方向の `value:` を含むテンプレート）は、従来どおり束縛ごとの record を
 * 使う。行 record はプラン行だけの形なので、この経路が残っていることを固定する。
 */
const TWOWAY_LIST = `<template data-wcs="for: items"><input class="field" data-wcs="value: items.*.name"></template>`;

describe("行 session — プラン不適格な行（束縛ごとの record）", () => {
  const fields = (root: ParentNode): string[] =>
    Array.from(root.querySelectorAll<HTMLInputElement>(".field")).map((el) => el.value);

  it("生成・更新・一部削除が働くこと", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }],
    }, TWOWAY_LIST);
    expect(fields(shadowRoot)).toEqual(["a", "b"]);

    write(stateEl, (state) => { state.$resolve("items.*.name", [1], "B"); });
    await flush();
    expect(fields(shadowRoot)).toEqual(["a", "B"]);

    write(stateEl, (state) => { state.items = [{ name: "only" }]; });
    await flush();
    expect(fields(shadowRoot)).toEqual(["only"]);
  });

  it("全消去（wholesale destroy）のあと作り直せること", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }, { name: "c" }],
    }, TWOWAY_LIST);

    write(stateEl, (state) => { state.items = []; });
    await flush();
    expect(fields(shadowRoot)).toEqual([]);

    write(stateEl, (state) => { state.items = [{ name: "x" }, { name: "y" }]; });
    await flush();
    expect(fields(shadowRoot)).toEqual(["x", "y"]);

    write(stateEl, (state) => { state.$resolve("items.*.name", [0], "X"); });
    await flush();
    expect(fields(shadowRoot)).toEqual(["X", "y"]);
  });

  it("`_state` の入れ直しで、束縛のアドレスが新しい世代へ張り直されること", async () => {
    const { shadowRoot, stateEl } = await mount({
      items: [{ name: "a" }, { name: "b" }],
    }, TWOWAY_LIST);

    stateEl.setInitialState({ items: [{ name: "p" }, { name: "q" }] });
    await flush();
    expect(fields(shadowRoot)).toEqual(["p", "q"]);

    write(stateEl, (state) => { state.$resolve("items.*.name", [1], "Q"); });
    await flush();
    expect(fields(shadowRoot)).toEqual(["p", "Q"]);
  });
});


