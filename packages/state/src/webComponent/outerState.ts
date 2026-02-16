import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { getPathInfo } from "../address/PathInfo";
import { IStateElement } from "../components/types";
import { raiseError } from "../raiseError";
import { getLastValueByAbsoluteStateAddress } from "./lastValueByAbsoluteStateAddress";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";
import { IOuterState } from "./types";

class OuterStateProxyHandler implements ProxyHandler<IOuterState> {
  private _webComponent: Element;
  private _innerStateElement: IStateElement;
  constructor(webComponent: Element, stateName: string) {
    this._webComponent = webComponent;
    this._innerStateElement = getStateElementByWebComponent(webComponent, stateName) ?? raiseError('State element not found for web component.');
  }

  get(target: IOuterState, prop: string | symbol, receiver: any): any {
    if (typeof prop === 'string') {
      const innerPathInfo = getPathInfo(prop);
      const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
      const absStateAddress = createAbsoluteStateAddress(innerAbsPathInfo, null);
      return getLastValueByAbsoluteStateAddress(absStateAddress);
    } else {
      return Reflect.get(target, prop, receiver);
    }
  }

  set(target: IOuterState, prop: string | symbol, value: any, receiver: any): boolean {
    if (typeof prop === 'string') {
      const innerPathInfo = getPathInfo(prop);
      const innerAbsPathInfo = getAbsolutePathInfo(this._innerStateElement, innerPathInfo);
      this._innerStateElement.createState("readonly", (state) => {
        state.$postUpdate(innerAbsPathInfo.pathInfo.path);
      });
      return true;
    } else {
      return Reflect.set(target, prop, value, receiver);
    }
  }
}

export function createOuterState(webComponent: Element, stateName: string): IOuterState {
  const handler = new OuterStateProxyHandler(webComponent, stateName);
  return new Proxy({}, handler);
}
