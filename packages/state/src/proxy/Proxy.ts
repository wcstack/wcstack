import { getPathInfo } from "../address/PathInfo";
import { IBindingInfo, IState } from "../types";
import { IPathInfo } from "../address/types";
import { getListIndexesByList, setListIndexesByList } from "../list/listIndexesByList";
import { createListIndexes } from "../list/createListIndexes";
import { applyChange } from "../apply/applyChange";
import { IListIndex } from "../list/types";

class StateHandler implements ProxyHandler<IState> {
  private _bindingInfosByPath: Map<string, IBindingInfo[]>;
  private _listPaths: Set<string>;
  private _stackListIndex: (IListIndex | null)[] = [];
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
    if (parent == null) {
      console.warn(`[@wcstack/state] Cannot access property "${pathInfo.path}" - parent is null or undefined.`);
      return undefined;
    }
    const lastSegment = curPathInfo.segments[curPathInfo.segments.length - 1];
    if (lastSegment === '*') {
      const wildcardCount = curPathInfo.wildcardPositions.length;
      if (wildcardCount === 0 || wildcardCount > this._stackListIndex.length) {
        console.warn(`[@wcstack/state] Cannot get value for path "${pathInfo.path}" - invalid wildcard depth.`);
        return undefined;
      }
      const listIndex = this._stackListIndex[wildcardCount - 1];
      if (listIndex === null) {
        console.warn(`[@wcstack/state] Cannot get value for path "${pathInfo.path}" because list index is null.`);
        return undefined;
      }
      return Reflect.get(parent, listIndex.index);
    } else if (lastSegment in parent) {
      return Reflect.get(parent, lastSegment);
    } else {
      console.warn(`[@wcstack/state] Property "${pathInfo.path}" does not exist on state.`);
      return undefined;
    }
  }

  $stack(listIndex: IListIndex, callback:()=>any, receiver: any): any {
    this._stackListIndex.push(listIndex);
    try {
      return Reflect.apply(callback, receiver, []);
    } finally {
      this._stackListIndex.pop();
    }
  }

  get(target: IState, prop: PropertyKey, receiver: any): any {
    let value: any;
    try {
      if (typeof prop === "string") {
        if (prop === "$stack") {
          return (listIndex: IListIndex, callback:()=>any) => {
            return this.$stack(listIndex, callback, receiver);
          }
        }
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
        if (this._listPaths.has(prop) && value != null) {
          if (getListIndexesByList(value) === null) {
            const parentListIndex = this._stackListIndex.length > 0 
              ? this._stackListIndex[this._stackListIndex.length - 1] 
              : null;
            const listIndexes = createListIndexes(value, parentListIndex);
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
        if (parent == null) {
          console.warn(`[@wcstack/state] Cannot set property "${pathInfo.path}" - parent is null or undefined.`);
          return false;
        }
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
      if (this._listPaths.has(prop) && value != null) {
        const parentListIndex = this._stackListIndex.length > 0 
          ? this._stackListIndex[this._stackListIndex.length - 1] 
          : null;
        const listIndexes = createListIndexes(value, parentListIndex);
        setListIndexesByList(value, listIndexes);
      }
    }
    return result;
  }
}

export function createStateProxy(state: IState, bindingInfosByPath: Map<string, IBindingInfo[]>, listPaths: Set<string>): IState {
  return new Proxy<IState>(state, new StateHandler(bindingInfosByPath, listPaths));
}