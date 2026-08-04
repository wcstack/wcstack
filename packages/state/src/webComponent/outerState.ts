import { IStateElement } from "../components/types";
import { raiseError } from "../raiseError";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";
import { IOuterState } from "./types";

/**
 * コンポーネントの `bind-component` プロパティとして露出する proxy。
 * read / write とも子の state proxy へ素通しする。
 *
 * mapped（親から `<prop>.*` をバインドされている）ケースでは、素通し先の
 * innerState proxy がマッピング規則に従って親 state へ解決するので、
 * `this.state.msg` の読みは親の現在値になり、書きは親 state へ届く。
 * plain（親からのバインドなし）ケースでは子のローカル state に解決する。
 * **どちらでも同じ意味論になる**のが要点
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.1 / G1）。
 *
 * 以前は mapped 専用に「read = 最後に観測した値のキャッシュ／write = 値を捨てて
 * `$postUpdate` 通知のみ」という別 proxy を当てていた。あれは親 → 子の再読込通知という
 * **内部チャネル**としては正しかったが、それが公開 API を兼ねていたため、同じ
 * コンポーネント実装が親ページの書き方で挙動を変えていた。内部チャネルは
 * `applyChangeToWebComponent` が state element を直接引く形へ分離した。
 */
class OuterStateProxyHandler implements ProxyHandler<IOuterState> {
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

export function createOuterState(webComponent: Element, stateName: string): IOuterState {
  const handler = new OuterStateProxyHandler(webComponent, stateName);
  return new Proxy({}, handler);
}
