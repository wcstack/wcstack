/**
 * createWritableStateProxy.ts
 *
 * StateClassの「書き込み可能」プロキシを生成するための実装ファイルです。
 *
 * 主な役割:
 * - Stateオブジェクトに対して、書き込み可能なProxyを作成
 * - StateHandlerクラスで各種APIやトラップ（get/set）を実装
 * - getトラップでバインディングやAPI呼び出し、依存解決などに対応
 * - setトラップで値の書き込みや副作用（依存解決・再描画）を一元管理
 *
 * 設計ポイント:
 * - StateHandlerはIWritableStateHandlerを実装し、状態管理やAPI呼び出しの基盤となる
 * - callableApiに各種APIシンボルと関数をマッピングし、柔軟なAPI拡張が可能
 * - createWritableStateProxyで一貫した生成・利用が可能
 * - 依存解決やキャッシュ、ループ・プロパティ参照スコープ管理など多機能な設計
 */
import { IComponentEngine } from "../ComponentEngine/types";
import { IState, IWritableStateHandler, IWritableStateProxy } from "./_types";
import { set as trapSet } from "./traps/set.js";
import { ILoopContext } from "../LoopContext/types";
import { setLoopContext } from "./methods/setLoopContext";
import { IRenderer, IUpdater } from "../Updater/types";
import { IStatePropertyRef } from "../StatePropertyRef/types";
import { ConnectedCallbackSymbol, DisconnectedCallbackSymbol, GetByRefSymbol, GetListIndexesByRefSymbol, SetByRefSymbol } from "./_symbols";
import { get as trapGet } from "./traps/get.js";

const STACK_DEPTH = 32;

class StateHandler implements IWritableStateHandler {
  engine: IComponentEngine;
  refStack: (IStatePropertyRef | null)[] = Array(STACK_DEPTH).fill(null);
  refIndex: number = -1;
  lastRefStack: IStatePropertyRef | null = null;
  loopContext: ILoopContext | null = null;
  updater: IUpdater;
  renderer: IRenderer | null = null;
  symbols: Set<PropertyKey> = new Set<PropertyKey>([ GetByRefSymbol, SetByRefSymbol, GetListIndexesByRefSymbol, ConnectedCallbackSymbol, DisconnectedCallbackSymbol ]);
  apis: Set<PropertyKey> = new Set<PropertyKey>([ "$resolve", "$getAll", "$trackDependency", "$navigate", "$component" ]);
  
  constructor(engine: IComponentEngine, updater: IUpdater) {
    this.engine = engine;
    this.updater = updater;
  }

  get(
    target  : Object, 
    prop    : PropertyKey, 
    receiver: IWritableStateProxy
  ): any {
    return trapGet(target, prop, receiver, this);
  }

  set(
    target  : Object, 
    prop    : PropertyKey, 
    value   : any, 
    receiver: IWritableStateProxy
  ): boolean {
    return trapSet(target, prop, value, receiver, this);
  }

  has(
    target: Object, 
    prop  : PropertyKey
  ): boolean {
    return Reflect.has(target, prop) || this.symbols.has(prop) || this.apis.has(prop);
  }
}

export async function useWritableStateProxy(
  engine: IComponentEngine, 
  updater: IUpdater,
  state: Object,
  loopContext: ILoopContext | null,
  callback: (stateProxy: IWritableStateProxy, handler: IWritableStateHandler) => Promise<void>
): Promise<void> {
  const handler = new StateHandler(engine, updater);
  const stateProxy = new Proxy<IState>(state, handler) as IWritableStateProxy;
  return setLoopContext(handler, loopContext, async () => {
    await callback(stateProxy, handler);
  });
}

