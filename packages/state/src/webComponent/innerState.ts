import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { IAbsolutePathInfo, IPathInfo } from "../address/types";
import { IStateElement } from "../components/types";
import { DELIMITER } from "../define";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { ILoopContext } from "../list/types";
import { setLoopContextSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { getScopeArity } from "./baseListIndex";
import { getCrossBoundaryAddress } from "./crossBoundaryAddress";
import { getOuterAbsolutePathInfo, getPrimaryMappingRules, hasRootMappingRule } from "./MappingRule";
import { meltFrozenObject } from "./meltFrozenObject";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";
import { IInnerState } from "./types";

class InnerStateProxyHandler implements ProxyHandler<IInnerState> {
  private _webComponent: Element;
  private _innerStateElement: IStateElement;
  /**
   * ルート規則（`state: path` の丸ごとマウント）の下にいるか。プライマリ規則は
   * bindWebComponent が createInnerState より先に組むので、構築時に確定する。
   */
  private _rootMounted: boolean;
  /**
   * 部分規則（`state.theme: theme`）が覆う内側の先頭セグメント。ルート規則と併用された
   * とき、これらのキーは own data key があってもマッピング（1.x の既存挙動）に落とす。
   * 完了前の親の初期適用が `element.state.theme = obj` とキーを注入する（積み）ので、
   * own key の有無では作者の意図を判定できない（webComponent/preCompletionWrites.ts）。
   */
  private _partialFirstSegments: Set<string> | null;
  constructor(webComponent: Element, stateName: string) {
    this._webComponent = webComponent;
    this._innerStateElement = getStateElementByWebComponent(webComponent, stateName) ?? raiseError('State element not found for web component.');
    this._rootMounted = hasRootMappingRule(webComponent);
    this._partialFirstSegments = null;
    if (this._rootMounted) {
      const rules = getPrimaryMappingRules(webComponent);
      for (const rule of rules ?? []) {
        if (!rule.isRoot) {
          (this._partialFirstSegments ??= new Set()).add(rule.innerAbsPathInfo.pathInfo.segments[0]);
        }
      }
    }
  }

  /**
   * R1（docs/state-mount-design.md D4 / D19）: ルートマウント下では、コンポーネントが
   * 自分で書いた data key は**私有**で、マウント先のツリーを隠す。v1 の解決順
   * （getter → マッピング → ローカル）のままルート規則を載せると、ルート規則は全キーに
   * 一致するので own key が全部ツリーに隠され、2.0 と逆の意味論で出荷することになる。
   *
   * 判定は**先頭セグメント**で行う。getByAddress は `"draft.title" in target` → 偽 →
   * 親アドレス `draft` の読み、と降りてくるので、先頭が私有ならその下は素のオブジェクト
   * 走査になる（plain な state と同じ）。getter / setter は規則 1（chroot 評価）なので除く。
   *
   * 部分マウントだけのコンポーネントには適用しない（1.x の既存挙動＝マッピングが勝つ、を
   * 維持する。2.0 での反転は bindWebComponent が warn で予告する — D19）。
   */
  private _isPrivateKey(target: IInnerState, prop: string): boolean {
    if (!this._rootMounted) {
      return false;
    }
    const dot = prop.indexOf(DELIMITER);
    const first = dot === -1 ? prop : prop.slice(0, dot);
    if (!Object.prototype.hasOwnProperty.call(target, first)) {
      return false;
    }
    if (this._partialFirstSegments !== null && this._partialFirstSegments.has(first)) {
      return false;
    }
    return !this._innerStateElement.getterPaths.has(first) && !this._innerStateElement.setterPaths.has(first);
  }

  /**
   * 親スコープで読み書きするときのループ文脈を決める。候補は 2 つある。
   *
   * 1. **越境直前のアドレスの listIndex**。子スコープの `for` が回している行
   *    （§1.8）。子の listIndex は base（＝ホストの親スコープ行）を親に持つので
   *    チェーン長は Δ+W_inner ＝ W_outer になり、そのまま外側の文脈として使える
   *    （docs/state-bind-component-nested-for-design.md）。
   * 2. **コンポーネント要素のノードループ文脈**。コンポーネント自身が親の `for` の
   *    中にいるが、読んでいるパスは子スコープのループの外という形（`state.row: rows.*`）。
   *
   * 1 を先に見るのは、内側ほど具体的だから。入れ子形では 2 も非 null（＝Δ 段だけ）に
   * なるが、それでは外側パスの段数に足りない。段数が一致する候補だけを採るのが
   * 判定の本体で、両方外れたら null（親側の解決に委ね、解けなければ raiseError。
   * 無言の取り違えを作らない）。
   */
  private _outerLoopContext(innerPathInfo: IPathInfo, outerAbsPathInfo: IAbsolutePathInfo): ILoopContext | null {
    const outerWildcardCount = outerAbsPathInfo.pathInfo.wildcardCount;
    // 段数の照合は外側スコープの**実 arity**（パスの段数 + そのスコープの Δ）で行う。
    // 境界 1 枚なら外側は Δ=0 で従来と同値、2 枚以上あるときに中間スコープの Δ を
    // 数えないと候補が両方とも外れて loopContext が null になる（§1.12）。
    // 添字（wildcardPaths）に使うのは Δ を含まない段数のままであることに注意。
    const outerArity = getScopeArity(outerAbsPathInfo.stateElement, outerAbsPathInfo.pathInfo);
    const nodeLoopContext = getLoopContextByNode(this._webComponent);
    if (nodeLoopContext !== null && nodeLoopContext.listIndex.length === outerArity) {
      return nodeLoopContext;
    }
    if (outerWildcardCount > 0) {
      const address = getCrossBoundaryAddress(this._innerStateElement, innerPathInfo.path);
      const listIndex = address?.listIndex ?? null;
      if (listIndex !== null && listIndex.length === outerArity) {
        const outerWildcardPath = outerAbsPathInfo.pathInfo.wildcardPaths[outerWildcardCount - 1];
        return createStateAddress(getPathInfo(outerWildcardPath), listIndex) as ILoopContext;
      }
    }
    // どちらも段数が合わない。従来どおりノードの文脈へフォールバックし、
    // 解けなければ後段が raiseError する（無言の取り違えを作らない）
    return nodeLoopContext;
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
      // 1'. R1: ルートマウント下の own data key → 私有（マッピングより先）
      if (this._isPrivateKey(target, prop)) {
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
      // 1'. R1: ルートマウント下の own data key → 私有に書く
      if (this._isPrivateKey(target, prop)) {
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
      // 1'. R1: 先頭が私有キーなら素のオブジェクトの答え（完全一致だけ真。`draft.title` は
      // 偽を返して getByAddress に親アドレスから降りてもらう）
      if (this._isPrivateKey(target, prop)) {
        return prop in target;
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