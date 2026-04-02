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
    } catch {
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
      if (!stateEl) return;
      return stateEl.initializePromise.then(() => {
        return stateEl.createStateAsync("writable", async (state) => {
          await state[name](...args);
        });
      });
    };
  }
  return function (this: IDCCElement, ...args: any[]) {
    const stateEl = this.stateElement;
    if (!stateEl) return;
    stateEl.initializePromise.then(() => {
      stateEl.createState("writable", (state) => {
        state[name](...args);
      });
    });
  };
}

export function isInternalProperty(name: string): boolean {
  return name.startsWith("$");
}
