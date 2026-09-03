/**
 * devtools/types.ts
 *
 * DevTools Hook Protocol (docs/devtools-hook-protocol.md) の型定義。
 *
 * イベント payload はランタイム内部オブジェクト（IAbsoluteStateAddress /
 * IBindingInfo 等）への生参照を含む（同一 realm・オーバーレイ前提、protocol 原則 4）。
 * 消費者はこれらを変異してはならない。
 */

import type { IAbsoluteStateAddress } from "../address/types";
import type { IBindingInfo } from "../binding/types";
import type { IStateElement } from "../components/types";

/** グローバル registry のプロパティ名 */
export const DEVTOOLS_HOOK_GLOBAL = "__WCSTACK_DEVTOOLS_HOOK__";

/** プロトコル版。additive change では上げない（protocol §2） */
export const DEVTOOLS_PROTOCOL_VERSION = 2;

export type DevtoolsEvent =
  | {
      readonly type: "state:element-registered";
      readonly rootNode: Node;
      readonly element: IStateElement;
    }
  | {
      readonly type: "state:element-unregistered";
      readonly rootNode: Node;
      readonly element: IStateElement;
    }
  | {
      readonly type: "state:write";
      readonly absoluteAddress: IAbsoluteStateAddress;
      readonly value: unknown;
      /** same-value guard が既に取得していた場合のみ意味を持つ（protocol §4.2） */
      readonly oldValue: unknown;
      readonly hasOldValue: boolean;
    }
  | {
      readonly type: "state:update-batch";
      readonly addresses: ReadonlySet<IAbsoluteStateAddress>;
    }
  | {
      readonly type: "state:binding-added";
      readonly absoluteAddress: IAbsoluteStateAddress;
      readonly binding: IBindingInfo;
    }
  | {
      readonly type: "state:binding-removed";
      readonly absoluteAddress: IAbsoluteStateAddress;
      readonly binding: IBindingInfo;
    }
  | {
      readonly type: "state:binding-cleared";
      readonly absoluteAddress: IAbsoluteStateAddress;
    }
  | {
      readonly type: "state:token-emit";
      readonly kind: "command" | "event";
      readonly tokenName: string;
      readonly args: readonly unknown[];
      readonly subscriberCount: number;
    }
  | {
      // `$watch` の実行中に throw した（docs/state-watch-hook-design.md §7-1）。
      // watch は 1 バッチで N 個走り drain フックを他機能と共有するため、例外は
      // watch 側で閉じる（console.error のみ）。それだと devtools から
      // 「静かに握られた失敗」が見えないので、同じ地点からここにも流す。
      readonly type: "state:watch-error";
      /** throw 元。cur の評価（getter）とハンドラ本体では原因も直し方も違う */
      readonly phase: "prime" | "evaluate" | "handler";
      /** `$watch` の宣言キー（ワイルドカードを含む生のパス） */
      readonly path: string;
      readonly error: unknown;
    }
  | {
      // watch 起点の書き込み連鎖が深さ上限で打ち切られた（設計書 §7-2）。
      // 値と binding 適用は巻き戻さない ＝ propagation:hop-limit と同じ姿勢。
      readonly type: "state:watch-chain-limit";
      readonly maxDepth: number;
      /** 打ち切ったバッチに載っていたアドレスのパス（報告用） */
      readonly paths: readonly string[];
    }
  | {
      // `$watch` ハンドラの正常発火（state-watch-hook-design.md §11 で予約済み・
      // static-wiring-dx-design.md §4 の配線カバレッジが消費）。値は載せない —
      // 「宣言したのに一度も発火しない」の検出には発火の事実だけで足りる。
      readonly type: "state:watch-fired";
      /** `$watch` の宣言キー（ワイルドカードを含む生のパス） */
      readonly path: string;
    }
  | {
      // バインド / `$watch` の対象パスが state 上で解決しないと確定した
      // （pathDiagnostics.ts）。ランタイムは console.warn に留めて続行するため、
      // 「配線したのに黙って死んでいる」を devtools からも見えるようにする。
      readonly type: "state:path-unresolved";
      /** 書き手が書いた面。診断 code が binding / watch で変わる */
      readonly source: "binding" | "watch";
      /** 宣言されたパス（ワイルドカードを含む生の文字列） */
      readonly path: string;
      /** 解決に失敗したセグメント */
      readonly missingSegment: string;
    }
  | {
      // binding 適用が throw したが、バッチの残りは続行した（apply/applyChangeFromBindings）。
      // 例外を握らずに隔離した事実を観測可能にする（state:watch-error と同じ位置づけ）。
      readonly type: "state:binding-apply-error";
      /** バインディングの state パス（ワイルドカードを含む生の文字列） */
      readonly path: string;
      readonly bindingType: string;
      readonly error: unknown;
    }
  | {
      readonly type: "propagation:suppressed";
      readonly reason: "confirmation" | "visited-edge";
      readonly transactionId: number;
      readonly edgeId: number;
      readonly node: Node;
      readonly member: string;
    }
  | {
      readonly type: "propagation:coalesced";
      readonly absoluteAddress: IAbsoluteStateAddress;
      readonly droppedTransactionId: number;
      readonly winnerTransactionId: number;
    }
  | {
      readonly type: "propagation:hop-limit";
      readonly absoluteAddress: IAbsoluteStateAddress;
      readonly transactionId: number;
      readonly hop: number;
    }
  // --- contract analyzer (Phase 5b, §6 contract category) ---
  | {
      // sidecar manifest から 1 コンポーネント契約を読んだ(dev-time analyzer)。
      readonly type: "contract:manifest-read";
      readonly tag: string;
      /** 実行時に該当タグが登録済みか(未登録なら drift の起点)。 */
      readonly loaded: boolean;
    }
  | {
      // manifest の未知 namespace / extension(runtime analyzer が解釈しない)。
      readonly type: "contract:unsupported-extension";
      readonly namespace: string;
    }
  | {
      // sidecar と live wcBindable 宣言の drift。live 宣言が正本。
      readonly type: "contract:drift";
      readonly reason: "component-not-loaded" | "missing-member" | "event-mismatch";
      readonly tag: string;
      readonly member?: string;
      /** event-mismatch のとき: sidecar 宣言 event / live event。 */
      readonly sidecarEvent?: string;
      readonly liveEvent?: string;
    };

export type DevtoolsSink = (event: DevtoolsEvent) => void;

/** contract analyzer(Phase 5b)が生成しうる event だけの狭い union(公開 API の戻り型)。 */
export type ContractEvent = Extract<
  DevtoolsEvent,
  { readonly type: "contract:manifest-read" | "contract:unsupported-extension" | "contract:drift" }
>;

/** マウント記録 1 件の要約（overlays — protocol v2）。 */
export interface IMountOverlaySummary {
  /** D20 の予約セグメント（`#m<id>`） */
  readonly marker: string;
  /** マウントされたコンポーネントのタグ名（小文字） */
  readonly componentTag: string;
  readonly stateProp: string;
  /** マウント表: 内側接頭辞（空 = ルートエントリ）→ 外側パス */
  readonly mountTable: readonly { readonly inner: string; readonly outer: string }[];
  /** `$n` 補正の Δ（ルート接頭辞のワイルドカード数） */
  readonly delta: number;
  /** 私有キー（作者の own data key — オーバーレイ空間に住む） */
  readonly privateKeys: readonly string[];
  /** マーカーパスに載る getter のキー */
  readonly getterKeys: readonly string[];
}

export interface IStateElementSummary {
  readonly rootNode: Node;
  readonly element: IStateElement;
  readonly paths: {
    readonly list: ReadonlySet<string>;
    readonly element: ReadonlySet<string>;
    readonly getter: ReadonlySet<string>;
    readonly setter: ReadonlySet<string>;
  };
  readonly commandTokenNames: ReadonlySet<string>;
  readonly eventTokenNames: ReadonlySet<string>;
  readonly staticDependency: ReadonlyMap<string, readonly string[]>;
  readonly dynamicDependency: ReadonlyMap<string, readonly string[]>;
  /**
   * `$watch` の宣言パス集合（宣言なしは null）。protocol v1 追補（additive）—
   * 配線カバレッジの「宣言面」（static-wiring-dx-design.md §4）。
   */
  readonly watchPaths: ReadonlySet<string> | null;
  /**
   * `$listKeys` で宣言されたリストパス集合（宣言なしは null）。protocol v1 追補
   * （additive）— ワイルドカード行 watch に**リスト書き込み**が届く前提は
   * 「for バインド or $listKeys 宣言」（state-watch-hook-design.md §6-3）なので、
   * paths.list（for 由来）と合わせて初めてカバレッジの前提判定が正確になる
   *（明示 index 書き込みは前提に依らず発火し得る）。
   */
  readonly keyedListPaths: ReadonlySet<string> | null;
}

/**
 * 宣言レベルのバインディング 1 件（getDeclaredBindings の要素）。
 * 正本パーサ（bindTextParser）の結果をそのまま流す — devtools 側の簡易パーサ
 * （declaredScan）が「bindTextParser 非追随」と自己申告していたドリフトの恒久解消。
 * filters は IFilterInfo の構造的サブセット（filterName / args）として読める。
 *
 * getDeclaredBindings の戻り値は**宣言の集合**（宣言タプルで dedupe 済み）であり、
 * レンダリング行数に比例したインスタンス列ではない。インスタンス粒度は live の
 * binding 台帳（state:binding-added）の守備範囲。
 */
export interface IDeclaredBindingInfo {
  /**
   * 宣言を代表するノード（要素またはコメントアンカー。同一宣言の複数出現は
   * 最初に見つかったノード）。構造テンプレート内部の宣言（origin: 'fragment'）は
   * live DOM にノードを持たないため null。
   */
  readonly node: Node | null;
  readonly propName: string;
  readonly statePathName: string;
  readonly bindingType: string;
  readonly inFilters: readonly { readonly filterName: string; readonly args: readonly string[] }[];
  readonly outFilters: readonly { readonly filterName: string; readonly args: readonly string[] }[];
  readonly origin: "attribute" | "comment" | "fragment";
  /**
   * 宣言の原文。構造ディレクティブのアンカー（origin: 'comment'）は原文が DOM に
   * 残らないためレジストリ UUID、fragment 由来は空文字。
   */
  readonly raw: string;
}

export interface IDevtoolsSource {
  readonly id: string;
  readonly kind: "state";
  readonly packageVersion: string;
  getStateElements(): IStateElementSummary[];
  /**
   * state のトップレベルキー（データプロパティ + 実行可能な getter）を列挙する。
   * メソッド・`$` 始まり・ワイルドカードを含むキーは除外。
   * 状態ツリー UI の描画起点（protocol §3）。
   */
  keys(rootNode: Node): string[];
  /**
   * rootNode のツリーに載っているマウント記録の列挙（protocol v2 — D20 の可視化）。
   * マーカー（`#m<id>`）ごとに、マウント表と私有面（オーバーレイ専用アドレス空間に
   * 住むキー）を出す。マウントが無ければ空配列。
   */
  overlays(rootNode: Node): IMountOverlaySummary[];
  read(rootNode: Node, path: string, indexes?: number[]): unknown;
  write(rootNode: Node, path: string, value: unknown, indexes?: number[]): void;
  /**
   * rootNode 配下の宣言レベルのバインディングを正本パーサで列挙する
   * （protocol v1 追補・additive）。live DOM（属性 + コメントアンカー）に加え、
   * DOM から引き上げられた構造テンプレート内部（fragment レジストリ）も含む —
   * DOM 再スキャン方式の declared ビューでは原理的に見えなかった領域。
   */
  getDeclaredBindings(rootNode: Node): IDeclaredBindingInfo[];
  /** registry 専用。listener の有無に応じて registry が差し替える */
  _setSink(sink: DevtoolsSink | null): void;
}

export interface IDevtoolsListener {
  onSourceRegistered?(source: IDevtoolsSource): void;
  onSourceUnregistered?(sourceId: string): void;
  onEvent?(sourceId: string, event: DevtoolsEvent): void;
}

export interface IDevtoolsHookRegistry {
  readonly version: number;
  readonly sources: Map<string, IDevtoolsSource>;
  register(source: IDevtoolsSource): void;
  unregister(sourceId: string): void;
  /** 戻り値は解除関数。既登録 source は onSourceRegistered で即時リプレイされる */
  addListener(listener: IDevtoolsListener): () => void;
}
