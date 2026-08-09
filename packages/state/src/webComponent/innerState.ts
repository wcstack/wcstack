import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { IAbsolutePathInfo, IPathInfo } from "../address/types";
import { IStateElement } from "../components/types";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { ILoopContext } from "../list/types";
import { setLoopContextSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { getCrossBoundaryAddress } from "./crossBoundaryAddress";
import { getOuterAbsolutePathInfo } from "./MappingRule";
import { meltFrozenObject } from "./meltFrozenObject";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";
import { IInnerState } from "./types";

class InnerStateProxyHandler implements ProxyHandler<IInnerState> {
  private _webComponent: Element;
  private _innerStateElement: IStateElement;
  constructor(webComponent: Element, stateName: string) {
    this._webComponent = webComponent;
    this._innerStateElement = getStateElementByWebComponent(webComponent, stateName) ?? raiseError('State element not found for web component.');
  }

  /**
   * 親スコープで読み書きするときのループ文脈を決める。
   *
   * 1. コンポーネント自身が親スコープの `for` の中にいる形（`state.row: rows.*`）は
   *    従来どおりノードのループ文脈。行を決めているのは親スコープ側のループ。
   * 2. そうでなく外側のパスにワイルドカードが残る形は、子スコープの `for` が
   *    回している行。越境直前のアドレスから listIndex を引き継いで文脈を組む
   *    （§1.8）。listIndex 台帳は配列オブジェクトの同一性で引かれるため、
   *    親子は同じ `IListIndex` を共有していて、そのまま流用できる。
   *
   * どちらでも決められない場合は null。従来どおり親側の解決に委ね、
   * ワイルドカードが解けなければ raiseError になる（無言の取り違えを作らない）。
   */
  private _outerLoopContext(innerPathInfo: IPathInfo, outerAbsPathInfo: IAbsolutePathInfo): ILoopContext | null {
    const nodeLoopContext = getLoopContextByNode(this._webComponent);
    if (nodeLoopContext !== null) {
      return nodeLoopContext;
    }
    const outerWildcardCount = outerAbsPathInfo.pathInfo.wildcardCount;
    if (outerWildcardCount === 0) {
      return null;
    }
    const address = getCrossBoundaryAddress(this._innerStateElement, innerPathInfo.path);
    const listIndex = address?.listIndex ?? null;
    // 段数が合わない ＝ 親スコープのループと子スコープのループが混在する入れ子形。
    // 両者の listIndex は親子チェーンが繋がっていない別物なので合成できない。
    if (listIndex === null || listIndex.length !== outerWildcardCount) {
      return null;
    }
    const outerWildcardPath = outerAbsPathInfo.pathInfo.wildcardPaths[outerWildcardCount - 1];
    return createStateAddress(getPathInfo(outerWildcardPath), listIndex) as ILoopContext;
  }

  get(target: IInnerState, prop: string | symbol, receiver: any): any {
    if (typeof prop === 'string') {
      if (prop === "then") {
        // Promiseのthenと誤認識されるのを防ぐため、Promiseに存在するプロパティはProxyのgetで処理しない
        return undefined;
      }
      if (prop[0] === '$') {
        return undefined;
      }
      // 1. getter完全一致 → ローカル計算（this = receiverで依存自動追跡）
      if (this._innerStateElement.getterPaths.has(prop) && prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      // 2 & 3. マッピング完全一致 / サブパス → 親の状態
      const innerPathInfo = getPathInfo(prop);
      const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
      const outerAbsPathInfo = getOuterAbsolutePathInfo(this._webComponent, innerAbsPathInfo);
      if (outerAbsPathInfo !== null) {
        const loopContext = this._outerLoopContext(innerPathInfo, outerAbsPathInfo);
        let value = undefined;
        outerAbsPathInfo.stateElement.createState("readonly", (state) => {
          state[setLoopContextSymbol](loopContext, () => {
            value = state[outerAbsPathInfo.pathInfo.path];
          });
        });
        return value;
      }
      // 4. ローカルデータプロパティ → ローカル値
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      // 5. エラー
      raiseError(`Property "${prop}" not found in inner state: no mapping rule and no local state property.`);
    } else {
      return Reflect.get(target, prop, receiver);
    }
  }

  set(target: IInnerState, prop: string | symbol, value: any, receiver: any): boolean {
    if (typeof prop === 'string') {
      // 1. setter完全一致 → ローカル処理（this = receiverで親への書き込み可能）
      if (this._innerStateElement.setterPaths.has(prop) && prop in target) {
        return Reflect.set(target, prop, value, receiver);
      }
      // 2 & 3. マッピング完全一致 / サブパス → 親に書く
      const innerPathInfo = getPathInfo(prop);
      const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
      const outerAbsPathInfo = getOuterAbsolutePathInfo(this._webComponent, innerAbsPathInfo);
      if (outerAbsPathInfo !== null) {
        const loopContext = this._outerLoopContext(innerPathInfo, outerAbsPathInfo);
        outerAbsPathInfo.stateElement.createState("writable", (state) => {
          state[setLoopContextSymbol](loopContext, () => {
            state[outerAbsPathInfo.pathInfo.path] = value;
          });
        });
        return true;
      }
      // 4. ローカルデータプロパティ → ローカルに書く
      if (prop in target) {
        return Reflect.set(target, prop, value, receiver);
      }
      // 5. エラー
      raiseError(`Property "${prop}" not found in inner state: no mapping rule and no local state property.`);
    } else {
      return Reflect.set(target, prop, value, receiver);
    }
  }

  has(target: IInnerState, prop: string | symbol): boolean {
    if (typeof prop === 'string') {
      if (prop[0] === '$') {
        return false;
      }
      // 1. getter/setter完全一致
      if ((this._innerStateElement.getterPaths.has(prop) || this._innerStateElement.setterPaths.has(prop)) && prop in target) {
        return true;
      }
      // 2 & 3. マッピング
      const innerPathInfo = getPathInfo(prop);
      const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
      const outerAbsPathInfo = getOuterAbsolutePathInfo(this._webComponent, innerAbsPathInfo);
      if (outerAbsPathInfo !== null) {
        return true;
      }
      // 4. ローカルデータ
      if (prop in target) {
        return true;
      }
      // 5. 存在しない
      return false;
    } else {
      return Reflect.has(target, prop);
    }
  }

}

export function createInnerState(webComponent: Element, stateName: string): IInnerState {
  const handler = new InnerStateProxyHandler(webComponent, stateName);
  const innerState = getStateElementByWebComponent(webComponent, stateName);
  /* c8 ignore start */
  if (innerState === null) {
    raiseError('State element not found for web component.');
  }
  /* c8 ignore stop */
  if (innerState.boundComponentStateProp === null) {
    raiseError('State element is not bound to any component state prop.');
  }
  if (!(innerState.boundComponentStateProp in webComponent)) {
    raiseError(`State element is not bound to a valid component state prop: ${innerState.boundComponentStateProp}`);
  }
  const state = (webComponent as any)[innerState.boundComponentStateProp];
  if (typeof state !== 'object' || state === null) {
    raiseError(`Invalid state object for component state prop: ${innerState.boundComponentStateProp}`);
  }
  return new Proxy(meltFrozenObject(state), handler);
}