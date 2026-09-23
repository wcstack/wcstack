/**
 * 鍵付き購読の**祖先逆引き**（`dependency/keyedDependency.ts` の `descendantRowsByAncestor`）の
 * 不変条件を、内部台帳を直接覗いて検査する番人。
 *
 * この逆引きは「入れ子リストの親行が退役したら子行の購読も落とす」ためのもので、公開されている面
 * （描画・D17 の `collectKeyedSubscriptions`）からは中身が見えない。そのため、
 * `integration.keyedDerived.test.ts` の回帰テストでは次の 2 つを殺せなかった:
 *
 * - **M4**: `dropRowSubscriptions` の `unlinkAncestors` を消す。購読を失った行が、**生きている**
 *   祖先の集合に残り続ける（＝長寿命の親行の下で子行の出入りが多いページでのリーク）。
 *   残った行への `dropRowSubscriptions` は冪等なので、描画にも D17 の数字にも出ない。
 * - **R1**: 祖先チェーンのドリフト。逆引きは「行の最初の購読」の時点で 1 回だけ記録し、
 *   `listIndexesByList.ts` の `getRepairTarget` は**旧親が退役していなくても** `home` へ
 *   付け替えうる。付け替えが起きると (a) 旧親の退役が生きている行の購読を落とす、
 *   (b) 実親の退役が子を落とし損ねる（＝指摘 4 の再発）の 2 方向で壊れる。
 *
 * 計装は `vitest.config.ts` の `wcs-keyed-dependency-probe`（vite の `transform`）で行う。
 * **`src/` は 1 バイトも変えない** — bundle にも `d.ts` にもこの口は出ない。目印が消えたら
 * プラグイン側が throw するので、番人が黙って無効になることはない。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { IListIndex } from "../src/list/types";

beforeAll(() => {
  bootstrapState();
});

interface IKeyedProbe {
  links: [IListIndex, IListIndex][];
  descendantRowsByAncestor: WeakMap<IListIndex, Set<IListIndex>>;
  entriesByListIndex: WeakMap<IListIndex, unknown[]>;
  pendingKeyedWalk: WeakMap<object, Set<unknown>>;
}

/** 計装が当たっていなければ落とす（当たっていないのに緑、が一番まずい） */
async function getProbe(): Promise<IKeyedProbe> {
  const mod = await import("../src/dependency/keyedDependency") as unknown as { __keyedProbe?: IKeyedProbe };
  const probe = mod.__keyedProbe;
  expect(probe, "vitest.config.ts の wcs-keyed-dependency-probe が当たっていない").toBeDefined();
  return probe as IKeyedProbe;
}

/**
 * 祖先逆引きに載ったままの行をすべて突き合わせる。
 * - 載っている ＝ その行はまだ購読を持っているはず（M4）
 * - 載っている ＝ その祖先は今も `parentListIndex` チェーン上に居るはず（R1）
 */
function assertAncestorIndexIsConsistent(probe: IKeyedProbe): void {
  const stale: string[] = [];
  const drifted: string[] = [];
  for (const [ancestor, row] of probe.links) {
    const rows = probe.descendantRowsByAncestor.get(ancestor);
    if (typeof rows === "undefined" || !rows.has(row)) {
      continue; // 既に外れている（正常）
    }
    if (typeof probe.entriesByListIndex.get(row) === "undefined") {
      stale.push(`[${row.indexes.join(",")}] under [${ancestor.indexes.join(",")}]`);
      continue;
    }
    let onChain = false;
    for (let p: IListIndex | null = row.parentListIndex; p !== null; p = p.parentListIndex) {
      if (p === ancestor) {
        onChain = true;
        break;
      }
    }
    if (!onChain) {
      drifted.push(`[${row.indexes.join(",")}] no longer under [${ancestor.indexes.join(",")}]`);
    }
  }
  expect(stale, "購読を失った行が、生きている祖先の逆引きに残っている（unlinkAncestors の抜け）").toEqual([]);
  expect(drifted, "逆引きが記録した祖先が、現在の parentListIndex チェーンに居ない（付け替えのドリフト）").toEqual([]);
}

/**
 * 差分が積んだ鍵付きウォークの起点が、バッチをまたいで持ち越されていないこと（R2）。
 *
 * 引き取りは `walkDependency` の末尾 1 箇所だけで、依存ゼロの起点が通る先頭の fast path
 * （`walkDependency.ts` の `callback(startAddress); return [];`）は drain を通らない。
 * 積むのは `createListDiff` の中なので、fast path 自身は積まない ＝ 取り残しが出るのは
 * 「ウォークの外で積まれ、そのバッチのウォークが fast path だけだった」場合に限られる。
 * 現状その形は作れない（`createListDiff` はキャッシュ命中で `moveIndexWatchers` が早戻りする）。
 * この検査はその前提を監視するためのもので、破れたら fast path にも drain を置く合図。
 */
function assertNoPendingKeyedWalk(probe: IKeyedProbe, stateElement: object): void {
  const pending = probe.pendingKeyedWalk.get(stateElement);
  expect(
    typeof pending === "undefined" ? 0 : pending.size,
    "差分が積んだ鍵付きウォークの起点が引き取られずに残っている（walkDependency の fast path を疑う）",
  ).toBe(0);
}

let counter = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(probe: IKeyedProbe, body: string, state: Record<string, any>) {
  const host = document.createElement(`kai-host-${++counter}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state></wcs-state>${body}`;
  document.body.appendChild(host);
  const element = shadowRoot.querySelector("wcs-state") as State;
  element.setInitialState(state);
  await element.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  await flush();
  const stateElement = getStateElement(shadowRoot)!;
  /** 台帳の不変条件をまとめて見る。各段の後で必ず呼ぶ */
  const check = (): void => {
    assertAncestorIndexIsConsistent(probe);
    assertNoPendingKeyedWalk(probe, stateElement);
  };
  const write = async (fn: (s: any) => void): Promise<void> => {
    element.createState("writable", fn);
    await flush();
    await flush();
  };
  const rows = (): number => shadowRoot.querySelectorAll("li.row").length;
  return { host, shadowRoot, write, check, rows };
}

const NESTED = `<ul><template data-wcs="for: groups"><li><ul>`
  + `<template data-wcs="for: groups.*.rows"><li class="row" data-wcs="class.on: groups.*.rows.*.hit"></li></template>`
  + `</ul></li></template></ul>`;

describe("鍵付き購読の祖先逆引き（内部台帳の不変条件）", () => {
  it("計装が当たっていること（当たっていなければ以降の番人は無意味）", async () => {
    const probe = await getProbe();
    expect(Array.isArray(probe.links)).toBe(true);
    expect(probe.descendantRowsByAncestor).toBeInstanceOf(WeakMap);
    expect(probe.entriesByListIndex).toBeInstanceOf(WeakMap);
  });

  it("親が生きたまま子行が消えても、祖先の逆引きに死んだ行が残らないこと", async () => {
    const probe = await getProbe();
    const { host, write, check, rows } = await mount(probe, NESTED, {
      sel: 0,
      groups: [{ rows: [{}, {}, {}] }, { rows: [{}, {}, {}] }],
      get "groups.*.rows.*.hit"(this: any) { return this.$eq("sel", this.$2); },
    });
    expect(rows()).toBe(6);
    expect(probe.links.length).toBeGreaterThan(0);
    check();

    // 親（groups の行）は同一性を保ったまま、子行だけ 1 行減らす
    await write((s) => {
      const groups = s.groups;
      groups[0].rows = groups[0].rows.slice(1);
      s.groups = [...groups];
    });
    expect(rows()).toBe(5);
    check();

    // 子行を全部消す（祖先の集合が空になって外れる経路）
    await write((s) => {
      const groups = s.groups;
      groups[0].rows = [];
      s.groups = [...groups];
    });
    expect(rows()).toBe(3);
    check();

    host.remove();
  });

  it("親行ごと退役しても、子行の増減を繰り返しても、逆引きが整合したままであること", async () => {
    const probe = await getProbe();
    const makeGroups = (n: number) => Array.from({ length: n }, () => ({ rows: [{}, {}] }));
    const { host, shadowRoot, write, check, rows } = await mount(probe, NESTED, {
      sel: 1,
      groups: makeGroups(3),
      get "groups.*.rows.*.hit"(this: any) { return this.$eq("sel", this.$2); },
    });
    check();

    for (const n of [2, 3, 1, 4, 0, 2]) {
      await write((s) => { s.groups = makeGroups(n); });
      expect(rows()).toBe(n * 2);
      check();
    }

    // 生きている行の購読を落とさないこと（逆向きの破れ）を、描画側からも押さえる
    await write((s) => { s.sel = 0; });
    expect(shadowRoot.querySelectorAll("li.row.on").length).toBe(2);
    check();

    host.remove();
  });

  /**
   * `$eqIndex` の最内段はリスト単位の watcher で、差分（`moveIndexWatchers`）が
   * 保留バッファへ積む唯一の経路の 1 つ。行の出入りを繰り返しても取り残しが出ないことを見る。
   */
  it("$eqIndex の行が出入りしても、保留バッファに取り残しが出ないこと", async () => {
    const probe = await getProbe();
    const makeRows = (n: number) => Array.from({ length: n }, () => ({}));
    const { host, write, check, rows } = await mount(probe, NESTED, {
      sel: 1,
      unrelated: 0,
      groups: [{ rows: makeRows(3) }, { rows: makeRows(3) }],
      get "groups.*.rows.*.hit"(this: any) { return this.$eqIndex("sel", 2); },
      // 派生 getter を挟む（差分駆動の通知が依存ウォークへ渡る経路を通す）
      get "groups.*.rows.*.label"(this: any) { return this["groups.*.rows.*.hit"] ? "Y" : "N"; },
    });
    expect(rows()).toBe(6);
    check();

    for (const n of [2, 4, 1, 3]) {
      await write((s) => {
        const groups = s.groups;
        groups[0].rows = makeRows(n);
        s.groups = [...groups];
      });
      expect(rows()).toBe(n + 3);
      check();
    }

    // 依存ゼロのパスへの書き込み（walkDependency の fast path）を挟んでも取り残しが出ないこと
    await write((s) => { s.unrelated = 1; });
    check();

    await write((s) => { s.groups = []; });
    expect(rows()).toBe(0);
    check();

    host.remove();
  });
});
