import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getPathInfo } from "../address/PathInfo";
import { IStateElement } from "../components/types";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { IListIndex } from "../list/types";
import { setLoopContextSymbol } from "../proxy/symbols";
import { raiseError } from "../raiseError";
import { setLastValueByAbsoluteStateAddress } from "./lastValueByAbsoluteStateAddress";
import { getOuterAbsolutePathInfo } from "./MappingRule";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";
import { IInnerState } from "./types";

class InnerStateProxyHandler implements ProxyHandler<IInnerState> {
  private _webComponent: Element;
  private _innerStateElement: IStateElement;
  constructor(webComponent: Element, stateName: string) {
    this._webComponent = webComponent;
    this._innerStateElement = getStateElementByWebComponent(webComponent, stateName) ?? raiseError('State element not found for web component.');
  }

  get(target: IInnerState, prop: string | symbol, receiver: any): any {
    if (typeof prop === 'string') {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      if (prop[0] === '$') {
        return undefined;
      }
      const innerPathInfo = getPathInfo(prop);
      const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
      const outerAbsPathInfo = getOuterAbsolutePathInfo(this._webComponent, innerAbsPathInfo);
      if (outerAbsPathInfo === null) {
        raiseError(`Outer path info not found for inner path "${innerAbsPathInfo.pathInfo.path}" on web component.`);
      }
      const loopContext = getLoopContextByNode(this._webComponent);
      let value = undefined;
      outerAbsPathInfo.stateElement.createState("readonly", (state) => {
        state[setLoopContextSymbol](loopContext, () => {
          value = state[outerAbsPathInfo.pathInfo.path];
          let listIndex: IListIndex | null = null;
          if (loopContext !== null && loopContext.listIndex !== null) {
            if (outerAbsPathInfo.pathInfo.wildcardCount > 0) {
              // wildcardPathSetとloopContextのpathInfoSetのintersectionのうち、segment数が最も多いものをouterAbsPathInfoにする
              // 例: outerPathInfoが "todos.*.name"で、loopContextのpathInfoSetに "todos.0.name", "todos.1.name"がある場合、"todos.0.name"や"todos.1.name"をouterAbsPathInfoにする
              listIndex = loopContext.listIndex.at(outerAbsPathInfo.pathInfo.wildcardCount - 1);
            }
          }
          const absStateAddress = createAbsoluteStateAddress(outerAbsPathInfo, listIndex);
          setLastValueByAbsoluteStateAddress(absStateAddress, value);
        });
      });
      return value;
    } else {
      return Reflect.get(target, prop, receiver);
    }
  }

  set(target: IInnerState, prop: string | symbol, value: any, receiver: any): boolean {
    if (typeof prop === 'string') {
      const innerPathInfo = getPathInfo(prop);
      const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
      const outerAbsPathInfo = getOuterAbsolutePathInfo(this._webComponent, innerAbsPathInfo);
      if (outerAbsPathInfo === null) {
        raiseError(`Outer path info not found for inner path "${innerAbsPathInfo.pathInfo.path}" on web component.`);
      }
      const loopContext = getLoopContextByNode(this._webComponent);
      outerAbsPathInfo.stateElement.createState("writable", (state) => {
        state[setLoopContextSymbol](loopContext, () => {
          state[outerAbsPathInfo.pathInfo.path] = value;
        });
      });
      return true;
    } else {
      return Reflect.set(target, prop, value, receiver);
    }
  }

  has(target: IInnerState, prop: string | symbol): boolean {
    if (typeof prop === 'string') {
      if (prop in target) {
        return Reflect.has(target, prop);
      }
      if (prop[0] === '$') {
        return false;
      }
      const innerPathInfo = getPathInfo(prop);
      const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
      const outerAbsPathInfo = getOuterAbsolutePathInfo(this._webComponent, innerAbsPathInfo);
      if (outerAbsPathInfo === null) {
        return false;
      }
      return true;
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
  return new Proxy(state, handler);
}