/**
 * __tests__/helpers/recursionTestUtils.ts
 *
 * integration.recursion*.test.ts が共有するマウント・読み書き・木の工場。
 * getAll / getter / setAll / knownDefects / prerequisites の 5 ファイルでほぼ同文だった
 * `mount` / `read` / `write` / `writeError` / `TNode` / `node` / `forest` / `recursionState` の
 * 共通化（挙動不変のリファクタ。`mount` はホストタグ名の接頭辞だけがファイル間差分だったため、
 * 接頭辞を引数化したファクトリ `makeMount` として抽出 — streamTestUtils の `makeConnectHost` と同じ形）。
 *
 * `recursionState` は**基本形**（`nodes` ＋ `$recursion` ＋ `get "nodes.**.total"()`）だけを持つ。
 * 合併形の getter（`treeTotal` / `treeValues`）を足すファイルは `UNION_TOTAL` / `UNION_VALUES` を
 * `extra` に混ぜる（定義順は挙動に影響しない）。
 *
 * State は型としてのみ参照する（import type）。使う側は bootstrapState() 済みであること。
 */

import type { State } from "../../src/components/State";

/** マクロタスクを 1 つ進める（updater の drain と deferReport を流す） */
export const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r));

export interface IMountedState {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  stateEl: State;
}

/**
 * shadow ホストに `innerHTML` と `<wcs-state>` を置いて初期 state をセットし、バインディングの
 * 確立まで待つ `mount` を、ホストタグ名の接頭辞を固定して払い出すファクトリ。
 * ShadowRoot 単位でバインディングの構築が閉じるため、テスト間で干渉しない
 * （接頭辞はテストファイルごとに一意にする）。
 */
export function makeMount(prefix: string): (initial: any, innerHTML?: string) => Promise<IMountedState> {
  let seq = 0;
  return async (initial: any, innerHTML = ""): Promise<IMountedState> => {
    const host = document.createElement(`${prefix}-${seq++}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState(initial);
    await stateEl.connectedCallbackPromise;
    await (stateEl.constructor as typeof State).getBindingsReady(shadowRoot);
    return { host, shadowRoot, stateEl };
  };
}

/** readonly セッションで読み、コールバックの戻り値を外へ逃がす。 */
export function read<T>(stateEl: State, fn: (s: any) => T): T {
  let out: any;
  stateEl.createState("readonly", (s: any) => { out = fn(s); });
  return out as T;
}

/** writable セッションで書く。 */
export function write(stateEl: State, fn: (s: any) => void): void {
  stateEl.createState("writable", fn);
}

/**
 * `$setAll` の戻り値（書いた件数）を取り出す。
 * `createState("writable", cb)` は **cb の戻り値を返さない**ので、外の変数へ逃がす。
 */
export function writeCount(stateEl: State, fn: (s: any) => number): number {
  let count = -1;
  stateEl.createState("writable", (s: any) => { count = fn(s); });
  return count;
}

/** throw した場合はそのメッセージ、しなかった場合は空文字。 */
export function writeError(stateEl: State, fn: (s: any) => void): string {
  try {
    stateEl.createState("writable", fn);
  } catch (e: any) {
    return String(e && e.message);
  }
  return "";
}

// ---------------------------------------------------------------------------
// 木と再帰 state
// ---------------------------------------------------------------------------

export type TNode = { value: number; children: TNode[]; [key: string]: any };
export const node = (value: number, children: TNode[] = []): TNode => ({ value, children });

/**
 * 深さ 3 の木。
 *   nodes[0] = 1 ─┬─ 10 ── 100
 *                 └─ 20
 *   nodes[1] = 2
 * 手で畳んだ total: 100 / 110 / 20 / 131 / 2、全 value の合計 = 133。
 */
export const forest = (): TNode[] => [node(1, [node(10, [node(100)]), node(20)]), node(2)];

/** ルートに置く合併形の集計 getter（`extra` に混ぜる） */
export const UNION_TOTAL: PropertyDescriptor = {
  get(this: any) {
    return this.$getAll("nodes.**.value", []).reduce((a: number, b: number) => a + b, 0);
  },
  enumerable: true,
  configurable: true,
};

/** ルートに置く合併形の値列挙 getter（`extra` に混ぜる） */
export const UNION_VALUES: PropertyDescriptor = {
  get(this: any) { return this.$getAll("nodes.**.value", []); },
  enumerable: true,
  configurable: true,
};

/**
 * 標準の再帰 state。`get "nodes.**.total"()` は
 *   自分の value（`**` は自分の深さに束縛される）
 *   ＋ 直下の子の total（添字省略の `$getAll` ＝ 文脈の接頭辞に整合する分だけ）
 * を返す。`extra` で「作者が手で書いた具体パス getter」等を足せる。
 *
 * オブジェクトリテラルの getter として書くと、この関数の外で spread された時に
 * 本体が評価されてしまう。descriptor で足して事故を防ぐ。
 */
export function recursionState(
  nodes: any,
  extra: Record<string, PropertyDescriptor> = {},
  recursion: unknown = { "nodes.*": "children.*" },
): any {
  const state: any = { nodes };
  if (typeof recursion !== "undefined") {
    state.$recursion = recursion;
  }
  Object.defineProperty(state, "nodes.**.total", {
    get(this: any) {
      return this["nodes.**.value"] +
        this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
    },
    enumerable: true,
    configurable: true,
  });
  for (const [key, descriptor] of Object.entries(extra)) {
    Object.defineProperty(state, key, descriptor);
  }
  return state;
}
