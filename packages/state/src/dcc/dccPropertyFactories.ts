import { IStateElement } from "../components/types";

interface IDCCElement extends HTMLElement {
  readonly stateElement: IStateElement | null;
}

export function getterFn(name: string) {
  return function (this: IDCCElement) {
    const stateEl = this.stateElement;
    if (!stateEl) return undefined;
    // state のロード前は「まだ値が無い」だけで異常ではない。行がまだ fragment 上にある間の
    // 初期スナップショット読み（BindingSession.readProducerSnapshot）は必ずここを通るので、
    // warn を出すと通常フローが騒がしくなる
    // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.2）。
    if (stateEl.initialized !== true) return undefined;
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
    // 初期化済みなら同期で書く。getter は同期なので、ここを常に initializePromise 経由に
    // すると `el.count = 5; el.count` が旧値を返す（§2.2）。未初期化のときだけ遅延させる
    // ＝ 未接続の行に書かれた値が捨てられないための経路（§1.4）はそのまま残る。
    if (stateEl.initialized === true) {
      stateEl.createState("writable", (state) => {
        state[name] = value;
      });
      return;
    }
    stateEl.initializePromise.then(() => {
      stateEl.createState("writable", (state) => {
        state[name] = value;
      });
    });
  };
}

export function callFn(name: string, isAsync: boolean) {
  // 戻り値は常に Promise。state 側のメソッドが同期でも初期化待ちが挟まりうるため、
  // 呼び出し側から見た型を揃える（wcBindable.commands が一律 `async: true` を宣言するのと対）。
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
