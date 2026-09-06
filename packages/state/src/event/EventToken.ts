import type { IStateElement } from "../components/types";
import { devtoolsSink } from "../devtools/sink";
import { Token } from "../token/Token";

// EventToken は共有 pub/sub プリミティブ Token の薄い特化（element→state 方向）。
// instanceof による型判別を成立させるため独立クラスとして維持する。
export class EventToken extends Token {
  /**
   * 属する state 要素（devtools のツリー識別 — protocol v2 追補）。
   * registry（getOrCreateEventToken）経由の生成でのみ渡る optional 参照。
   * 寿命は registry 側の WeakMap が管理する（CommandToken と同じ位置づけ）。
   */
  private _stateElement: IStateElement | undefined;

  constructor(name: string, stateElement?: IStateElement) {
    super(name);
    this._stateElement = stateElement;
  }

  emit(...args: unknown[]): unknown[] {
    if (devtoolsSink !== null) {
      devtoolsSink({
        type: "state:token-emit",
        kind: "event",
        tokenName: this.name,
        args,
        subscriberCount: this.size,
        stateElement: this._stateElement,
      });
    }
    return super.emit(...args);
  }
}

export function isEventToken(value: unknown): value is EventToken {
  return value instanceof EventToken;
}
