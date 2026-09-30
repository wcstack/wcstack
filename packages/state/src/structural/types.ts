import { ParseBindTextResult } from "../bindTextParser/types";
import type { IInitialSyncPolicy, ResolvedInitialAuthority } from "../bindings/initialSync";
import type { IPlannedBinding } from "../bindings/planFilters";
import type { IDeferredSpreadEntry } from "../bindings/collectNodesAndBindingInfos";

export interface IContent {
  readonly firstNode: Node | null;
  readonly lastNode: Node | null;
  readonly mounted: boolean;
  appendTo(targetNode: Node): void;
  mountAfter(targetNode: Node): void;
  unmount(): void;
  /**
   * 自分のノードを DOM に残したままの解体（#4）。行の置き換えで `for` が同じ位置の Content を
   * 新しい行に使い回すとき、入力中の欄を DOM から外さずに unmount と同じ後始末をする。
   */
  unmountInPlace(): void;
  /**
   * wholesale 破棄: 全行クリアで再利用されない content の binding teardown
   * （listener 解除・アドレス台帳・loopContext 掃除）を省略し、ノード・binding
   * もろとも GC に任せる。定義待ち等の副作用がある場合は false を返し、呼び出し側が
   * 従来経路（deactivate + unmount）で解体する。
   */
  tryDestroy(): boolean;
  /**
   * まだ展開していない、未定義カスタム要素への spread（#330）。持つ行だけに付く（形を増やさない）。
   * 活性化のたびに定義待ちへ予約し、展開したものは外れる
   */
  spreads?: IDeferredSpreadEntry[];
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
  readonly template: IPlannedBinding;
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
  /**
   * トップレベルに構造ディレクティブ（for / if / elseif / else）のプレースホルダを
   * 持つか。undefined = 未判定でテンプレート単位に一度だけ算出しキャッシュする。
   * true の content だけが範囲モード（終端マーカー + 範囲移動）になる
   * （持たない大多数のテンプレートに追加コストを課さないための門）。
   */
  topLevelStructural?: boolean;
  /**
   * 中（入れ子のテンプレートも含む）で使う添字（`$N` → ビット N - 1、32 段目より奥は最上位のビットに
   * まとめる）の集合。undefined = 未判定で、テンプレート単位に一度だけ算出しキャッシュする。動いた行の段の
   * 添字を含まないテンプレートの構造ディレクティブは、当て直しで辿らない（createContent の isIndexBinding・
   * applyChangeToFor の applyIndexBindings・#390）。
   */
  indexBits?: number;
}