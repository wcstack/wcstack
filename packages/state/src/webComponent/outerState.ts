import { IStateElement } from "../components/types";
import { IOuterState } from "./types";

const getterFn = (
  innerStateElement: IStateElement,
  innerName: string
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
) => (v: any) => {
  innerStateElement.createState("readonly", (state) => {
    state.$postUpdate(innerName);
  });
}

class OuterState implements IOuterState {
  constructor() {
  }

  $$bindName(innerStateElement: IStateElement, innerName: string): void {
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