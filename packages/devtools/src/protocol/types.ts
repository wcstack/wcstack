/**
 * protocol/types.ts
 *
 * DevTools Hook Protocol (docs/devtools-hook-protocol.md) の devtools 側型定義。
 *
 * ランタイム（@wcstack/state）側の内部型は import しない — プロトコルは
 * 「文書化された構造」への構造的型付けで両側が独立に実装する（protocol §2）。
 * そのためランタイム内部オブジェクトは *Like インターフェースとして、
 * devtools が実際に触るプロパティだけを宣言する。
 */

/** グローバル registry のプロパティ名 */
export const DEVTOOLS_HOOK_GLOBAL = "__WCSTACK_DEVTOOLS_HOOK__";

/** プロトコル版。additive change では上げない（protocol §2） */
export const DEVTOOLS_PROTOCOL_VERSION = 2;

export interface IPathInfoLike {
  readonly path: string;
}

export interface IAbsolutePathInfoLike {
  readonly stateElement: unknown;
  readonly pathInfo: IPathInfoLike;
}

export interface IListIndexLike {
  readonly index: number;
  readonly indexes: number[];
}

export interface IAbsoluteAddressLike {
  readonly absolutePathInfo: IAbsolutePathInfoLike;
  readonly listIndex: IListIndexLike | null;
}

export interface IBindingLike {
  readonly propName: string;
  readonly statePathName: string;
  readonly bindingType: string;
  readonly node: Node;
  readonly replaceNode: Node;
}

export interface IStateElementSummaryLike {
  readonly rootNode: Node;
  readonly element: unknown;
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
   * `$watch` の宣言パス集合（protocol v1 追補・配線カバレッジの宣言面）。
   * 旧ランタイムにはフィールド自体が無いため optional。宣言なしは null。
   */
  readonly watchPaths?: ReadonlySet<string> | null;
  /**
   * `$listKeys` で宣言されたリストパス集合（protocol v1 追補）。ワイルドカード行
   * watch に**リスト書き込み**が届く前提は「for バインド（paths.list）or
   * $listKeys 宣言」なので、前提判定の正確化に paths.list と対で使う
   *（明示 index 書き込みは前提に依らず発火し得る）。旧ランタイムにはフィールド自体が
   * 無いため optional（undefined = $listKeys 側が観測不能）。宣言なしは null。
   */
  readonly keyedListPaths?: ReadonlySet<string> | null;
}

/**
 * 宣言レベルのバインディング 1 件（getDeclaredBindings の要素・protocol v1 追補）。
 * ランタイム正本パーサの結果が構造的に流れる。宣言タプルで dedupe 済みの
 * 「宣言の集合」であり、レンダリング行数に比例したインスタンス列ではない。
 */
export interface IDeclaredBindingLike {
  /** 代表ノード（fragment 由来 = 構造テンプレート内部は null）。 */
  readonly node: Node | null;
  readonly propName: string;
  readonly statePathName: string;
  readonly bindingType: string;
  readonly inFilters: readonly { readonly filterName: string; readonly args: readonly string[] }[];
  readonly outFilters: readonly { readonly filterName: string; readonly args: readonly string[] }[];
  readonly origin: "attribute" | "comment" | "fragment";
  readonly raw: string;
}

export type DevtoolsEventLike =
  | {
      readonly type: "state:element-registered";
      readonly rootNode: Node;
      readonly element: unknown;
    }
  | {
      readonly type: "state:element-unregistered";
      readonly rootNode: Node;
      readonly element: unknown;
    }
  | {
      readonly type: "state:write";
      readonly absoluteAddress: IAbsoluteAddressLike;
      readonly value: unknown;
      readonly oldValue: unknown;
      readonly hasOldValue: boolean;
    }
  | {
      readonly type: "state:update-batch";
      readonly addresses: ReadonlySet<IAbsoluteAddressLike>;
    }
  | {
      readonly type: "state:binding-added";
      readonly absoluteAddress: IAbsoluteAddressLike;
      readonly binding: IBindingLike;
    }
  | {
      readonly type: "state:binding-removed";
      readonly absoluteAddress: IAbsoluteAddressLike;
      readonly binding: IBindingLike;
    }
  | {
      readonly type: "state:binding-cleared";
      readonly absoluteAddress: IAbsoluteAddressLike;
    }
  | {
      readonly type: "state:token-emit";
      readonly kind: "command" | "event";
      readonly tokenName: string;
      readonly args: readonly unknown[];
      readonly subscriberCount: number;
    }
  | {
      // `$watch` の実行中の throw。watch は例外を自分で閉じる（drain と他機能を
      // 巻き添えにしないため）ので、これが無いと失敗が devtools から見えない。
      readonly type: "state:watch-error";
      readonly phase: "prime" | "evaluate" | "handler";
      readonly path: string;
      readonly error: unknown;
    }
  | {
      // watch 起点の書き込み連鎖が深さ上限で打ち切られた。
      readonly type: "state:watch-chain-limit";
      readonly maxDepth: number;
      readonly paths: readonly string[];
    }
  | {
      // `$watch` ハンドラの正常発火（protocol v1 追補・配線カバレッジの実測面）。
      // 値は載せない — 「宣言したのに一度も発火しない」の検出には発火の事実で足りる。
      readonly type: "state:watch-fired";
      readonly path: string;
    }
  | {
      // バインド / `$watch` の対象パスが state 上で解決しないと確定した。
      // ランタイムは console.warn で続行するので、これが無いと「配線したのに
      // 黙って死んでいる」が devtools から見えない。
      readonly type: "state:path-unresolved";
      readonly source: "binding" | "watch";
      readonly path: string;
      readonly missingSegment: string;
    }
  | {
      // binding 適用の throw。バッチの残りを守るためランタイムが隔離するので、
      // watch-error と同じくこれが無いと失敗がどこにも現れない。
      readonly type: "state:binding-apply-error";
      readonly path: string;
      readonly bindingType: string;
      readonly error: unknown;
    }
  | {
      // two-way エコーの辺単位抑止（enablePropagationContext 時のみ流れる）。
      readonly type: "propagation:suppressed";
      readonly reason: "confirmation" | "visited-edge";
      readonly transactionId: number;
      readonly edgeId: number;
      readonly node: Node;
      readonly member: string;
    }
  | {
      readonly type: "propagation:coalesced";
      readonly absoluteAddress: IAbsoluteAddressLike;
      readonly droppedTransactionId: number;
      readonly winnerTransactionId: number;
    }
  | {
      readonly type: "propagation:hop-limit";
      readonly absoluteAddress: IAbsoluteAddressLike;
      readonly transactionId: number;
      readonly hop: number;
    }
  | {
      // sidecar manifest から 1 コンポーネント契約を読んだ（opt-in contract analyzer）。
      readonly type: "contract:manifest-read";
      readonly tag: string;
      readonly loaded: boolean;
    }
  | {
      readonly type: "contract:unsupported-extension";
      readonly namespace: string;
    }
  | {
      // sidecar と live wcBindable 宣言の drift。live 宣言が正本。
      readonly type: "contract:drift";
      readonly reason: "component-not-loaded" | "missing-member" | "event-mismatch";
      readonly tag: string;
      readonly member?: string;
      readonly sidecarEvent?: string;
      readonly liveEvent?: string;
    };

export type DevtoolsSinkLike = (event: DevtoolsEventLike) => void;

export interface IDevtoolsSourceLike {
  readonly id: string;
  readonly kind: string;
  readonly packageVersion: string;
  getStateElements(): IStateElementSummaryLike[];
  /** protocol v1 追補 API。古いランタイムには無い可能性があるため optional 扱いで呼ぶ */
  keys?(rootNode: Node): string[];
  read(rootNode: Node, path: string, indexes?: number[]): unknown;
  write(rootNode: Node, path: string, value: unknown, indexes?: number[]): void;
  /**
   * protocol v1 追補 API（optional 扱いで呼ぶ）。ランタイム正本パーサによる
   * 宣言レベルバインディングの集合（declaredScan の簡易パーサを置き換える正本）。
   */
  getDeclaredBindings?(rootNode: Node): IDeclaredBindingLike[];
  _setSink(sink: DevtoolsSinkLike | null): void;
}

export interface IDevtoolsListenerLike {
  onSourceRegistered?(source: IDevtoolsSourceLike): void;
  onSourceUnregistered?(sourceId: string): void;
  onEvent?(sourceId: string, event: DevtoolsEventLike): void;
}

export interface IDevtoolsHookRegistryLike {
  readonly version: number;
  readonly sources: Map<string, IDevtoolsSourceLike>;
  register(source: IDevtoolsSourceLike): void;
  unregister(sourceId: string): void;
  addListener(listener: IDevtoolsListenerLike): () => void;
}
