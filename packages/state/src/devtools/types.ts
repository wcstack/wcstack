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
export const DEVTOOLS_PROTOCOL_VERSION = 1;

export type DevtoolsEvent =
  | {
      readonly type: "state:element-registered";
      readonly name: string;
      readonly rootNode: Node;
      readonly element: IStateElement;
    }
  | {
      readonly type: "state:element-unregistered";
      readonly name: string;
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
      readonly stateName: string | null;
      readonly tokenName: string;
      readonly args: readonly unknown[];
      readonly subscriberCount: number;
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
    };

export type DevtoolsSink = (event: DevtoolsEvent) => void;

export interface IStateElementSummary {
  readonly name: string;
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
  keys(name: string, rootNode: Node): string[];
  read(name: string, rootNode: Node, path: string, indexes?: number[]): unknown;
  write(name: string, rootNode: Node, path: string, value: unknown, indexes?: number[]): void;
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
