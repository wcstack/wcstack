import { applyChangeToNode } from "./applyChangeToNode";
import { getPathInfo } from "./address/PathInfo";
import { IBindingInfo, IState } from "./types";
import { IPathInfo } from "./address/types";
import { getListIndexesByList, setListIndexesByList } from "./list/listIndexesByList";
import { createListIndexes } from "./list/createListIndexes";
import { applyChange } from "./apply/applyChange";

class StateHandler implements ProxyHandler<IState> {
  private _bindingInfosByPath: Map<string, IBindingInfo[]>;
  private _listPaths: Set<string>;
  constructor(bindingInfosByPath: Map<string, IBindingInfo[]>, listPaths: Set<string>) {
    this._bindingInfosByPath = bindingInfosByPath;
    this._listPaths = listPaths;
  }

  private _getNestValue(target: IState, pathInfo: IPathInfo, receiver: any): any {
    let curPathInfo = pathInfo;
    if (curPathInfo.path in target) {
      return Reflect.get(target, curPathInfo.path, receiver);
    }
    const parentPathInfo = curPathInfo.parentPathInfo;
    if (parentPathInfo === null) {
      return undefined;
    }
    const parent = this._getNestValue(target, parentPathInfo, receiver);
    const lastSegment = curPathInfo.segments[curPathInfo.segments.length - 1];
    if (lastSegment in parent) {
      return Reflect.get(parent, lastSegment);
    } else {
      console.warn(`[@wcstack/state] Property "${pathInfo.path}" does not exist on state.`);
      return undefined;
    }
  }

  get(target: IState, prop: PropertyKey, receiver: any): any {
    let value: any;
    try {
      if (typeof prop === "string") {
        const pathInfo = getPathInfo(prop);
        if (pathInfo.segments.length > 1) {
          return (value = this._getNestValue(target, pathInfo, receiver));
        }
      }
      if (prop in target) {
        return (value = Reflect.get(target, prop, receiver));
      } else {
        console.warn(`[@wcstack/state] Property "${String(prop)}" does not exist on state.`);
        return undefined;
      }
    } finally {
      if (typeof prop === "string") {
        if (this._listPaths.has(prop)) {
          if (getListIndexesByList(value) === null) {
            // ToDo: parentListIndexをスタックから取得するように修正する
            const listIndexes = createListIndexes(value ?? [], null);
            setListIndexesByList(value, listIndexes);
          }
        }
      }
    }
  }

  set(target: IState, prop: PropertyKey, value: any, receiver: any): boolean {
    let result = false;
    if (typeof prop === "string") {
      const pathInfo = getPathInfo(prop);
      if (pathInfo.segments.length > 1) {
        if (pathInfo.parentPathInfo === null) {
          return false;
        }
        const parent = this._getNestValue(target, pathInfo.parentPathInfo, receiver);
        const lastSegment = pathInfo.segments[pathInfo.segments.length - 1];
        result = Reflect.set(parent, lastSegment, value);
      } else {
        result = Reflect.set(target, prop, value, receiver);
      }
      if (this._bindingInfosByPath.has(String(prop))) {
        const bindingInfos = this._bindingInfosByPath.get(String(prop)) || [];
        for(const bindingInfo of bindingInfos) {
          applyChange(bindingInfo, value);
        }
      }
    } else {
      result = Reflect.set(target, prop, value, receiver);
    }
    if (typeof prop === "string") {
      if (this._listPaths.has(prop)) {
        // ToDo: parentListIndexをスタックから取得するように修正する
        const listIndexes = createListIndexes(value ?? [], null);
        setListIndexesByList(value, listIndexes);
      }
    }
    return result;
  }
}

export function createStateProxy(state: IState, bindingInfosByPath: Map<string, IBindingInfo[]>, listPaths: Set<string>): IState {
  return new Proxy<IState>(state, new StateHandler(bindingInfosByPath, listPaths));
}