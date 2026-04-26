import { IStateElement } from "../components/types";

interface IDCCElement extends HTMLElement {
  readonly stateElement: IStateElement | null;
}

export function getterFn(name: string) {
  return function (this: IDCCElement) {
    const stateEl = this.stateElement;
    if (!stateEl) return undefined;
    let value: any;
    try {
      stateEl.createState("readonly", (state) => {
        value = state[name];
      });
    } catch (e) {
      console.warn(`[@wcstack/state] DCC getter "${name}" failed:`, e);
      return undefined;
    }
    return value;
  };
}

export function setterFn(name: string) {
  return function (this: IDCCElement, value: any) {
    const stateEl = this.stateElement;
    if (!stateEl) return;
    stateEl.initializePromise.then(() => {
      stateEl.createState("writable", (state) => {
        state[name] = value;
      });
    });
  };
}

export function callFn(name: string, isAsync: boolean) {
  if (isAsync) {
    return function (this: IDCCElement, ...args: any[]) {
      const stateEl = this.stateElement;
      if (!stateEl) return undefined;
      return stateEl.initializePromise.then(() => {
        let result: any;
        return stateEl.createStateAsync("writable", async (state) => {
          result = await state[name](...args);
        }).then(() => result);
      });
    };
  }
  return function (this: IDCCElement, ...args: any[]) {
    const stateEl = this.stateElement;
    if (!stateEl) return undefined;
    return stateEl.initializePromise.then(() => {
      let result: any;
      stateEl.createState("writable", (state) => {
        result = state[name](...args);
      });
      return result;
    });
  };
}

export function isInternalProperty(name: string): boolean {
  return name.startsWith("$");
}
