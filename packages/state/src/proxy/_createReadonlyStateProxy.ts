/**
 * createReadonlyStateProxy.ts
 *
 * StateClass の「読み取り専用」プロキシを生成します。
 *
 * 主な役割:
 * - State オブジェクトに対する読み取り専用の Proxy を作成
 * - get トラップでバインディング/API呼び出し/依存解決/レンダラー連携に対応
 * - set トラップは常に例外を投げて書き込みを禁止
 * - has トラップで内部APIシンボル（GetByRefSymbol 等）を公開
 *
 * Throws:
 * - STATE-202 Cannot set property ... of readonly state（set トラップ）
 */
import { IComponentEngine } from "../ComponentEngine/types";
import { IReadonlyStateHandler, IState, IReadonlyStateProxy } from "./_types";
import { raiseError } from "../utils";
import { ILoopContext } from "../LoopContext/types";
import { IRenderer, IUpdater } from "../Updater/types";
import { IStatePropertyRef } from "../StatePropertyRef/types";
import { GetByRefSymbol, GetListIndexesByRefSymbol } from "./_symbols";
import { get as trapGet } from "./traps/get.js";

const STACK_DEPTH = 32;

class StateHandler implements IReadonlyStateHandler {
  engine: IComponentEngine;
  updater: IUpdater;
  renderer: IRenderer | null;
  refStack: (IStatePropertyRef | null)[] = Array(STACK_DEPTH).fill(null);
  refIndex: number = -1;
  lastRefStack: IStatePropertyRef | null = null;
  loopContext: ILoopContext | null = null;
  symbols: Set<PropertyKey> = new Set<PropertyKey>([ GetByRefSymbol, GetListIndexesByRefSymbol ]);
  apis: Set<PropertyKey> = new Set<PropertyKey>([ "$resolve", "$getAll", "$trackDependency", "$navigate", "$component" ]);

  constructor(engine: IComponentEngine, updater: IUpdater, renderer: IRenderer | null) {
    this.engine = engine;
    this.updater = updater;
    this.renderer = renderer;
  }

  get(
    target  : Object, 
    prop    : PropertyKey, 
    receiver: IReadonlyStateProxy
  ): any {
    return trapGet(target, prop, receiver, this);
  }

  set(
    target  : Object, 
    prop    : PropertyKey, 
    value   : any, 
    receiver: IReadonlyStateProxy
  ): boolean {
    raiseError({
      code: 'STATE-202',
      message: `Cannot set property ${String(prop)} of readonly state`,
      context: { where: 'createReadonlyStateProxy.set', prop: String(prop) },
  docsUrl: './docs/error-codes.md#state',
    });
  }

  has(
    target: Object, 
    prop  : PropertyKey
  ): boolean {
    return Reflect.has(target, prop) || this.symbols.has(prop) || this.apis.has(prop);
  }
}

export function createReadonlyStateHandler(engine: IComponentEngine, updater: IUpdater, renderer: IRenderer | null): IReadonlyStateHandler {
  return new StateHandler(engine, updater, renderer);
}

export function createReadonlyStateProxy(
  state: Object,
  handler: IReadonlyStateHandler,
): IReadonlyStateProxy {
  return new Proxy<IState>(state, handler) as IReadonlyStateProxy;
}
