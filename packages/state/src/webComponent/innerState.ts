import { IStateElement } from "../components/types";
import { IInnerState } from "./types";

const getterFn = (
  outerStateElement: IStateElement,
  outerName: string
) => () => {
  let value = undefined;
  outerStateElement.createState("readonly", (state) => {
    value = state[outerName];
  });
  return value;
}

const setterFn = (
  outerStateElement: IStateElement,
  outerName: string,
) => (v: any) => {
  outerStateElement.createState("writable", (state) => {
    state[outerName] = v;
  });
}

class InnerState implements IInnerState {
  constructor() {
  }

  $$bindName(outerStateElement: IStateElement, innerName: string, outerName: string): void {
    Object.defineProperty(this, innerName, {
      get: getterFn(outerStateElement, outerName),
      set: setterFn(outerStateElement, outerName),
      enumerable: true,
      configurable: true,
    });
  }
}

export function createInnerState(): IInnerState {
  return new InnerState();
}