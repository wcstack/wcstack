/**
 * core/lifecycleHooks.ts — ライフサイクルの受け口（設計案 H3・H5、S4）。
 *
 * `connectedCallback` / `disconnectedCallback` の「この要素は自分のものだ」という分岐
 * （ボリューム `mount=`・DCC・bind-component）を機能側へ移すための受け口。機能は
 * `install()` で `registerLifecycleHooks` を呼び、core は登録順ではなく `order` の昇順で聞く
 * （install の順に依存させない — 従来の分岐順が契約なので、番号でそれを固定する）。
 *
 * `connecting` は「引き取らない」を **null** で返す。引き取るときだけ Promise を返すので、
 * 引き取り手の無い素の state（大多数）に microtask の境界を 1 つも足さない。
 */
import type { IStateElement } from "../components/types";
import { raiseError } from "../raiseError";
import { featureNotInstalledMessage } from "./featureEntries";

/** 引き取ったが待つものが無いときの返り値 */
export const CLAIMED: Promise<void> = /*#__PURE__*/ Promise.resolve();

/** 引き取るなら「この接続の初期化」の Promise、引き取らないなら null */
export type ConnectingHook = (element: IStateElement) => Promise<void> | null;
/** 引き取って切断を処理したなら true */
export type DisconnectingHook = (element: IStateElement) => boolean;
/**
 * 接続の前処理。「興味が無い」は null、あるなら「この要素を丸ごと引き取ったか」を解決する Promise。
 * `bind-component` のように「必ず走るが、引き取るのは条件つき」という機能のための段。
 */
export type PreparingHook = (element: IStateElement) => Promise<boolean> | null;
/** 初期化済みの要素の再接続を引き取ったなら true */
export type ReconnectingHook = (element: IStateElement) => boolean;
/** ルート要素の初期化が失敗した（このルートノードを待っている機能に知らせる） */
export type InitializeFailedHook = (element: IStateElement, rootNode: Node, error: unknown) => void;
/** 失敗したルート要素自身が DOM から消えた（「このルートにルートは来ない」はもう成り立たない） */
export type InitializeFailureClearedHook = (element: IStateElement, rootNode: Node) => void;
/** state の差し替えを拒むなら throw する（拒まないなら何もしない） */
export type ReplacingStateHook = (element: IStateElement) => void;

export interface ILifecycleHooks {
  /** 聞く順（従来の分岐順: DCC 10 → ボリューム 20 → bind-component 30） */
  readonly order: number;
  readonly connecting?: ConnectingHook;
  readonly preparing?: PreparingHook;
  readonly disconnecting?: DisconnectingHook;
  readonly reconnecting?: ReconnectingHook;
  readonly replacingState?: ReplacingStateHook;
  readonly initializeFailed?: InitializeFailedHook;
  readonly initializeFailureCleared?: InitializeFailureClearedHook;
}

const registry = new Map<string, ILifecycleHooks>();
let ordered: ILifecycleHooks[] = [];

/** 機能の install が呼ぶ（冪等） */
export function registerLifecycleHooks(feature: string, hooks: ILifecycleHooks): void {
  registry.set(feature, hooks);
  ordered = Array.from(registry.values()).sort((a, b) => a.order - b.order);
}

/**
 * 宣言（属性）が機能を要求したのに誰も引き取らなかった: 未 install として名指しで throw する
 * （readiness barrier、H5 / D13）。full / auto は `bootstrapState()` が install するので起きない。
 */
export function requireLifecycleFeature(feature: string, declaration: string): never {
  return raiseError(featureNotInstalledMessage(feature, declaration));
}

/** 接続を引き取る機能を探す。引き取り手が無ければ null（core が通常の初期化を続ける） */
export function runConnecting(element: IStateElement): Promise<void> | null {
  for (let i = 0; i < ordered.length; i++) {
    const claimed = ordered[i].connecting?.(element);
    if (claimed != null) {
      return claimed;
    }
  }
  return null;
}

/**
 * 接続の前処理を持つ機能を探す。1 つも無ければ null（素の state に microtask の境界を足さない）。
 * 解決値が true なら、その機能がこの要素を丸ごと引き取っている。
 */
export function runPreparing(element: IStateElement): Promise<boolean> | null {
  for (let i = 0; i < ordered.length; i++) {
    const prepared = ordered[i].preparing?.(element);
    if (prepared != null) {
      return prepared;
    }
  }
  return null;
}

/** 初期化済みの要素の再接続を引き取る機能を探す。引き取られたら true */
export function runReconnecting(element: IStateElement): boolean {
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].reconnecting?.(element) === true) {
      return true;
    }
  }
  return false;
}

/** state の差し替えを拒む機能に聞く（拒む機能は throw する） */
export function runReplacingState(element: IStateElement): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].replacingState?.(element);
  }
}

export function runInitializeFailed(element: IStateElement, rootNode: Node, error: unknown): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].initializeFailed?.(element, rootNode, error);
  }
}

export function runInitializeFailureCleared(element: IStateElement, rootNode: Node): void {
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].initializeFailureCleared?.(element, rootNode);
  }
}

/** 切断を引き取る機能を探す。引き取られたら true（core の後始末は走らない） */
export function runDisconnecting(element: IStateElement): boolean {
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].disconnecting?.(element) === true) {
      return true;
    }
  }
  return false;
}
