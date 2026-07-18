/**
 * r3.characterization.test.ts — 行実体化層再設計（jsfb Round 3）のオラクル。
 *
 * docs/state-row-instantiation-redesign.md §6 Phase 0。
 * 実体化層（createContent → BindingSession → 台帳登録）を作り替えても
 * 保存しなければならない「観測可能な台帳・drain の契約」を現状コードで pin する。
 *  - リオーダー（swap）は台帳ゼロタッチ（listIndex 同一性キーの帰結）
 *  - リオーダー後も drain lookup が正しい行に届く
 *  - drain は絶対アドレスのインスタンス同一性で dedup し 1 バッチに畳む
 *  - clear は pooled 行のみ従来 teardown（台帳削除あり）・超過分は wholesale（台帳削除ゼロ）
 *  - プール再利用行は activate で台帳へ再登録される
 *
 * 観測手段は devtools sink（state:binding-added/removed/cleared）と
 * updater の UpdateBatchListener。どちらも公開済みの計装点であり、
 * 実装詳細への白箱依存を最小化している。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";
import { setDevtoolsSink } from "../src/devtools/sink";
import type { DevtoolsEvent } from "../src/devtools/types";
import type { IAbsoluteStateAddress } from "../src/address/types";
import { peekBindingsForAddress } from "../src/binding/getBindingSetByAbsoluteStateAddress";
import type { IBindingInfo } from "../src/types";
import { registerUpdateBatchListener, unregisterUpdateBatchListener, UpdateBatchListener } from "../src/updater/updater";
import { __test_setMaxPooledContents } from "../src/apply/applyChangeToFor";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
let restoreCap: number | null = null;
let activeBatchListener: UpdateBatchListener | null = null;
const flush = () => new Promise((r) => setTimeout(r));

afterEach(() => {
  setDevtoolsSink(null);
  if (restoreCap !== null) {
    __test_setMaxPooledContents(restoreCap);
    restoreCap = null;
  }
  if (activeBatchListener !== null) {
    unregisterUpdateBatchListener(activeBatchListener);
    activeBatchListener = null;
  }
});

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`r3-host-${seq++}`);
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

type LedgerEvent = Extract<DevtoolsEvent, { type: "state:binding-added" | "state:binding-removed" | "state:binding-cleared" }>;

function isLedgerEvent(e: DevtoolsEvent): e is LedgerEvent {
  return e.type === "state:binding-added" || e.type === "state:binding-removed" || e.type === "state:binding-cleared";
}

/** 行スコープ（wildcard 解決済み listIndex 付き）の台帳イベントだけを抜く */
function rowLedgerEvents(events: DevtoolsEvent[], type: LedgerEvent["type"]): LedgerEvent[] {
  return events.filter((e): e is LedgerEvent => e.type === type && e.absoluteAddress.listIndex !== null);
}

describe("R3 オラクル: 台帳・drain の観測可能な契約", () => {
  it("リオーダー（swap）は台帳ゼロタッチ: binding-added/removed が発火せず Set 参照とメンバーが不変", async () => {
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((e) => events.push(e));
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }] },
      `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("li")).map((li) => li.textContent);
    expect(texts()).toEqual(["1", "2", "3", "4", "5"]);

    // mount 時の行スコープ登録（items.*.v ×5行）を pin: アドレス・binding・台帳エントリ参照
    const added = rowLedgerEvents(events, "state:binding-added");
    expect(added.length).toBe(5);
    const pinned = added.map((e) => ({
      addr: e.absoluteAddress,
      binding: (e as any).binding as IBindingInfo,
      entry: peekBindingsForAddress(e.absoluteAddress),
    }));
    for (const p of pinned) expect(p.entry).toBeDefined();

    // swap（jsfb と同じ keyed イディオム: 同じ行オブジェクトを並べ替えた新配列を代入）
    events.length = 0;
    stateElement.createState("writable", (s: any) => {
      const data = s.items.slice();
      [data[0], data[4]] = [data[4], data[0]];
      s.items = data;
    });
    await flush();
    expect(texts()).toEqual(["5", "2", "3", "4", "1"]);

    // 台帳ゼロタッチ: 追加・削除・クリアが 1 件も発生しない
    expect(events.filter(isLedgerEvent)).toEqual([]);
    // 台帳エントリはインスタンスごと不変・登録メンバーも不変（listIndex 同一性キーの帰結）
    for (const p of pinned) {
      const entry = peekBindingsForAddress(p.addr);
      expect(entry).toBe(p.entry);
      expect(entry === p.binding || (entry instanceof Set && entry.has(p.binding))).toBe(true);
    }
    host.remove();
  });

  it("リオーダー後の drain lookup: 移動した行オブジェクトへの書き込みが正しい DOM 行に届く", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ v: 1 }, { v: 2 }, { v: 3 }] },
      `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("li")).map((li) => li.textContent);
    stateElement.createState("writable", (s: any) => {
      const data = s.items.slice();
      [data[0], data[2]] = [data[2], data[0]];
      s.items = data;
    });
    await flush();
    expect(texts()).toEqual(["3", "2", "1"]);

    // 位置 0（旧3行目のオブジェクト）へのパス書き込みが先頭 <li> にだけ反映される
    stateElement.createState("writable", (s: any) => { s["items.0.v"] = 100; });
    await flush();
    expect(texts()).toEqual(["100", "2", "1"]);
    host.remove();
  });

  it("drain dedup: 同一アドレスへの N 回 set は 1 バッチ・1 エントリに畳まれる", async () => {
    const batches: ReadonlySet<IAbsoluteStateAddress>[] = [];
    activeBatchListener = (batch) => { batches.push(batch); };
    registerUpdateBatchListener(activeBatchListener);
    const { host, shadowRoot, stateElement } = await mount(
      { n: 0 },
      `<div id="n" data-wcs="textContent: n"></div>`,
    );
    batches.length = 0;
    stateElement.createState("writable", (s: any) => {
      for (let i = 1; i <= 100; i++) s.n = i;
    });
    await flush();
    expect(shadowRoot.querySelector("#n")!.textContent).toBe("100");
    // 100 回の set → drain 1 回
    expect(batches.length).toBe(1);
    // バッチ内の n はインスタンス同一性 dedup で 1 エントリ
    const paths = Array.from(batches[0]).map((a) => a.absolutePathInfo.pathInfo.path);
    expect(paths.filter((p) => p === "n").length).toBe(1);
    host.remove();
  });

  it("clear の分岐: pooled 行だけ台帳から削除され、プール超過分（wholesale）は台帳削除ゼロ", async () => {
    restoreCap = __test_setMaxPooledContents(2);
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((e) => events.push(e));
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }],
        onPick(this: any, _e: Event, _$1: number) {},
      },
      `<ul><template data-wcs="for: items"><li><a data-wcs="onclick: onPick">{{ .v }}</a></li></template></ul>`,
    );
    // mount で登録された行スコープ binding 数から 1 行あたりの登録数を自己較正
    const added = rowLedgerEvents(events, "state:binding-added");
    expect(added.length % 5).toBe(0);
    const perRow = added.length / 5;
    expect(perRow).toBeGreaterThan(0);

    events.length = 0;
    stateElement.createState("writable", (s: any) => { s.items = []; });
    await flush();
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(0);

    // 従来 teardown（台帳削除）は pooled 2 行分だけ。wholesale 3 行分は GC 任せで削除ゼロ
    const removed = rowLedgerEvents(events, "state:binding-removed");
    expect(removed.length).toBe(2 * perRow);
    host.remove();
  });

  it("プール再利用: clear 後の再生成で全行が台帳へ再登録される（pooled 行も新規行も）", async () => {
    restoreCap = __test_setMaxPooledContents(2);
    const events: DevtoolsEvent[] = [];
    setDevtoolsSink((e) => events.push(e));
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }] },
      `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("li")).map((li) => li.textContent);
    const perRow = rowLedgerEvents(events, "state:binding-added").length / 5;
    expect(perRow).toBeGreaterThan(0);

    stateElement.createState("writable", (s: any) => { s.items = []; });
    await flush();

    events.length = 0;
    stateElement.createState("writable", (s: any) => {
      s.items = [{ v: 10 }, { v: 20 }, { v: 30 }, { v: 40 }, { v: 50 }];
    });
    await flush();
    expect(texts()).toEqual(["10", "20", "30", "40", "50"]);
    // pooled 2 行（再 activate）＋新規 3 行の全行が再登録される
    const readded = rowLedgerEvents(events, "state:binding-added");
    expect(readded.length).toBe(5 * perRow);
    host.remove();
  });
});
