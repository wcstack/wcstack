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
export const DEVTOOLS_PROTOCOL_VERSION = 1;

export interface IPathInfoLike {
  readonly path: string;
}

export interface IAbsolutePathInfoLike {
  readonly stateName: string;
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
  readonly stateName: string;
  readonly bindingType: string;
  readonly node: Node;
  readonly replaceNode: Node;
}

export interface IStateElementSummaryLike {
  readonly name: string;
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
}

export type DevtoolsEventLike =
  | {
      readonly type: "state:element-registered";
      readonly name: string;
      readonly rootNode: Node;
      readonly element: unknown;
    }
  | {
      readonly type: "state:element-unregistered";
      readonly name: string;
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
      readonly stateName: string | null;
      readonly tokenName: string;
      readonly args: readonly unknown[];
      readonly subscriberCount: number;
    };

export type DevtoolsSinkLike = (event: DevtoolsEventLike) => void;

export interface IDevtoolsSourceLike {
  readonly id: string;
  readonly kind: string;
  readonly packageVersion: string;
  getStateElements(): IStateElementSummaryLike[];
  /** protocol v1 追補 API。古いランタイムには無い可能性があるため optional 扱いで呼ぶ */
  keys?(name: string, rootNode: Node): string[];
  read(name: string, rootNode: Node, path: string, indexes?: number[]): unknown;
  write(name: string, rootNode: Node, path: string, value: unknown, indexes?: number[]): void;
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
