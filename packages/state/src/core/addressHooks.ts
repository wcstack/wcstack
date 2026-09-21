/**
 * core/addressHooks.ts — 読み書き境界の受け口（設計案 H1、S3）。
 *
 * 機能は `install()` でレジストリに hook 実装を置く（hot path には触れない）。state 要素は
 * 宣言が要求する機能の hook だけを `attachAddressHooks` で自分に付け、core の各受け口は
 * `stateElement.addressHooks` が null なら判定 1 回で抜ける
 * （調査 §10.8: 大域配列の走査は読み +40%、state ごとの門なら +0.1 ns）。
 * 宣言が要求する機能が未 install なら `requireFeature` が宣言時に throw する（readiness barrier、D13）。
 *
 * 受け口（core 側の呼び出し点）:
 *   read         getByAddress の先頭（キャッシュより前）。名前空間・マーカーなど raw state に無い値を答える
 *   readMissing  getByAddress で「ツリーにそのキーが無い」と分かった点（親の値つき。親が無ければ null）
 *   write        setByAddress の先頭。書き込みを奪うか、禁止して throw する
 *   writeMissing setByAddress の fast path で「親にそのキーが無い」と分かった点（公開 getter への書き込み）
 *   writeObserve 旧値が分かった点（同値ガードの直後）。旧値の台帳を持つ機能が読む
 *   written      書き込み・`$postUpdate` の後。観測面へ通知する機能が読む
 *   swapped      要素の入れ替えで行が動いた点（旧値の台帳を行に追従させる）
 *   get          get トラップの文字列プロパティ先頭。API・名前空間・パスの翻訳を答える
 *   indexShift   `$n` の解決点。スコープ相対の段ずれを足す
 *   handlerScope イベントハンドラの添字の段数を決める点
 *   updated      `$updatedCallback` の後。相対配送する機能が読む
 *   suppressPathDiagnostic  束縛時の未宣言パス診断を黙らせるか（予約済みスロットの配下など）
 *   rowReused    その場で使い回した行（DOM から外れない）の点。行の中のスコープを新しい listIndex へ張り直す
 */
import type { IAbsoluteStateAddress, IPathInfo, IStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import type { ILoopContext } from "../list/types";
import type { IStateHandler } from "../proxy/types";
import type { IContent } from "../structural/types";
import { raiseError } from "../raiseError";
import { featureNotInstalledMessage } from "./featureEntries";

export const NOT_HANDLED: unique symbol = Symbol("wcs.notHandled");
export type ReadHook = (stateElement: IStateElement, address: IStateAddress, receiver: any, handler: IStateHandler) => unknown;
export type ReadMissingHook = (stateElement: IStateElement, address: IStateAddress, parentValue: object | null, receiver: any, handler: IStateHandler) => unknown;
export type WriteHook = (stateElement: IStateElement, address: IStateAddress, value: unknown, receiver: any, handler: IStateHandler) => unknown;
export type WriteMissingHook = (stateElement: IStateElement, address: IStateAddress, parentValue: object, key: PropertyKey, value: unknown, receiver: any, handler: IStateHandler) => unknown;
export type WriteObserveHook = (stateElement: IStateElement, path: string, absAddress: IAbsoluteStateAddress, oldValue: unknown, hasOldValue: boolean) => void;
export type WrittenHook = (stateElement: IStateElement, pathInfo: IPathInfo, detail?: { readonly value: unknown }) => void;
export type SwappedHook = (stateElement: IStateElement, elementAbsAddress: IAbsoluteStateAddress, displacedAbsAddress: IAbsoluteStateAddress) => void;
export type GetHook = (handler: IStateHandler, prop: string, receiver: any, target: object) => unknown;
export type IndexShiftHook = (handler: IStateHandler, lastAddress: IStateAddress) => number;
export type HandlerScopeHook = (stateElement: IStateElement, node: Node, rootNode: Node, loopContext: ILoopContext, wildcardCount: number) => number;
export type UpdatedHook = (stateElement: IStateElement, refs: IAbsoluteStateAddress[], receiver: any) => void;
export type SuppressPathDiagnosticHook = (stateElement: IStateElement, path: string) => boolean;
export type RowReusedHook = (stateElement: IStateElement, content: IContent) => void;

export interface IAddressHooks {
  readonly read?: ReadHook;
  readonly readMissing?: ReadMissingHook;
  readonly write?: WriteHook;
  readonly writeMissing?: WriteMissingHook;
  readonly writeObserve?: WriteObserveHook;
  readonly written?: WrittenHook;
  readonly swapped?: SwappedHook;
  readonly get?: GetHook;
  readonly indexShift?: IndexShiftHook;
  readonly handlerScope?: HandlerScopeHook;
  readonly updated?: UpdatedHook;
  readonly suppressPathDiagnostic?: SuppressPathDiagnosticHook;
  readonly rowReused?: RowReusedHook;
}
/** state 要素に付いた hook 群（種類ごとに、機能の登録順） */
export type IAttachedHooks = { readonly [K in keyof Required<IAddressHooks>]: NonNullable<IAddressHooks[K]>[] };

const HOOK_KINDS: readonly (keyof IAddressHooks)[] = [
  "read", "readMissing", "write", "writeMissing", "writeObserve", "written", "swapped",
  "get", "indexShift", "handlerScope", "updated", "suppressPathDiagnostic", "rowReused",
];

const registry = new Map<string, IAddressHooks>();

/** 機能の install が呼ぶ（冪等）。hot path には触れない */
export function registerFeatureHooks(feature: string, hooks: IAddressHooks): void {
  registry.set(feature, hooks);
}

export function isFeatureRegistered(feature: string): boolean {
  return registry.has(feature);
}

/** 宣言 `declaration` が機能 `feature` を要求した: 未 install なら名指しで throw する（D13） */
export function requireFeature(feature: string, declaration: string): IAddressHooks {
  const hooks = registry.get(feature);
  if (typeof hooks === "undefined") {
    raiseError(featureNotInstalledMessage(feature, `"${declaration}"`));
  }
  return hooks;
}

export function createAttachedHooks(): IAttachedHooks {
  return {
    read: [], readMissing: [], write: [], writeMissing: [], writeObserve: [], written: [], swapped: [],
    get: [], indexShift: [], handlerScope: [], updated: [], suppressPathDiagnostic: [], rowReused: [],
  };
}

/** `hooks` を `attached` に足す（同じ実装は 1 回だけ） */
export function appendHooks(attached: IAttachedHooks, hooks: IAddressHooks): void {
  for (let i = 0; i < HOOK_KINDS.length; i++) {
    const kind = HOOK_KINDS[i];
    const fn = hooks[kind];
    if (typeof fn === "undefined") continue;
    const list = attached[kind] as unknown[];
    if (!list.includes(fn)) list.push(fn);
  }
}

/** テスト・モック用: 機能の hook 群だけを持つ束を作る */
export function createAttachedHooksFrom(...hooksList: IAddressHooks[]): IAttachedHooks {
  const attached = createAttachedHooks();
  for (const hooks of hooksList) appendHooks(attached, hooks);
  return attached;
}
