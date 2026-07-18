import { ParseBindTextResult } from "../bindTextParser/types";
import type { IInitialSyncPolicy, ResolvedInitialAuthority } from "../bindings/initialSync";

export interface IContent {
  readonly firstNode: Node | null;
  readonly lastNode: Node | null;
  readonly mounted: boolean;
  appendTo(targetNode: Node): void;
  mountAfter(targetNode: Node): void;
  unmount(): void;
  /**
   * wholesale 破棄: 全行クリアで再利用されない content の binding teardown
   * （listener 解除・アドレス台帳・loopContext 掃除）を省略し、ノード・binding
   * もろとも GC に任せる。定義待ち等の副作用がある場合は false を返し、呼び出し側が
   * 従来経路（deactivate + unmount）で解体する。
   */
  tryDestroy(): boolean;
}

export interface IFragmentNodeInfo {
  readonly nodePath: number[];
  readonly parseBindTextResults: ParseBindTextResult[];
}

/**
 * RowPlan の 1 スロット = 行テンプレート内の 1 バインディング。
 * 行不変（全行で同一）の判定・解決結果をテンプレート単位で焼き込み、
 * 行の実体化を「clone → nodePath 解決 → スロットを写す」だけにする
 * （docs/state-row-instantiation-redesign.md §3-1）。
 */
export interface IRowPlanSlot {
  /** nodeInfos / 解決済みノード配列への添字 */
  readonly nodeIndex: number;
  /** 行不変フィールドの正本（node/replaceNode 以外の IBindingInfo 全フィールド） */
  readonly template: ParseBindTextResult;
  readonly isEvent: boolean;
  /** $1 等のインデックスバインディング（indexBindingsByContent 対象） */
  readonly isIndexBinding: boolean;
  /** テンプレート時に解決済みの initial-sync policy（observable=false 保証） */
  readonly policy: IInitialSyncPolicy;
  /** テンプレート時に解決済みの authority（"auto" はプラン不適格） */
  readonly authority: ResolvedInitialAuthority;
}

export interface IRowPlan {
  /** コンパイル時の config.enableDirectionalInitialSync（不一致なら再コンパイル） */
  readonly directional: boolean;
  readonly slots: readonly IRowPlanSlot[];
}

export interface IFragmentInfo {
  readonly fragment: DocumentFragment;
  readonly parseBindTextResult: ParseBindTextResult;
  readonly nodeInfos: IFragmentNodeInfo[];
  /**
   * 行実体化プランのキャッシュ。undefined = 未コンパイル、null = プラン不適格
   * （spread / カスタム要素 / 双方向 eligible / ネスト構造等を含む → 従来経路）。
   */
  rowPlan?: IRowPlan | null;
}