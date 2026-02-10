import { IBindingInfo } from "../binding/types";
import { IStateElement } from "../components/types";
import { IOuterState } from "./types";

const getterFn = (
  _innerStateElement: IStateElement,
  _innerName: string
) => () => {
/*
  let value = undefined;
  innerStateElement.createState("readonly", (state) => {
    value = state[innerName];
  });
  return value;
*/
  return undefined; // 暫定的に常に更新を発生させる
}

const setterFn = (
  innerStateElement: IStateElement,
  innerName: string,
) => (_v: any) => {
  innerStateElement.createState("readonly", (state) => {
    state.$postUpdate(innerName);
  });
}

class OuterState implements IOuterState {
  constructor() {
  }

  $$bind(innerStateElement: IStateElement, binding: IBindingInfo): void {
    const innerName = binding.propSegments.slice(1).join('.');
    Object.defineProperty(this, innerName, {
      get: getterFn(innerStateElement, innerName),
      set: setterFn(innerStateElement, innerName),
      enumerable: true,
      configurable: true,
    });
    
  }
  
}

export function createOuterState(): IOuterState {
  return new OuterState();
}