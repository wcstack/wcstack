import { IStateElement } from "../components/types";
import { raiseError } from "../raiseError";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";
import { IOuterState } from "./types";

class PlainOuterStateProxyHandler implements ProxyHandler<IOuterState> {
  private _innerStateElement: IStateElement;
  constructor(webComponent: Element, stateName: string) {
    this._innerStateElement = getStateElementByWebComponent(webComponent, stateName) ?? raiseError('State element not found for web component.');
  }

  get(target: IOuterState, prop: string | symbol, receiver: any): any {
    if (typeof prop === 'string') {
      let value;
      this._innerStateElement.createState("readonly", (state) => {
        value = state[prop];
      });
      return value;
    } else {
      return Reflect.get(target, prop, receiver);
    }
  }

  set(target: IOuterState, prop: string | symbol, value: any, receiver: any): boolean {
    if (typeof prop === 'string') {
      this._innerStateElement.createState("writable", (state) => {
        state[prop] = value;
      });
      return true;
    } else {
      return Reflect.set(target, prop, value, receiver);
    }
  }
}

export function createPlainOuterState(webComponent: Element, stateName: string): IOuterState {
  const handler = new PlainOuterStateProxyHandler(webComponent, stateName);
  return new Proxy({}, handler);
}
