import type { IStateElement } from "../components/types";
import { devtoolsSink } from "../devtools/sink";
import { Token } from "../token/Token";
import { ICommandToken } from "./types";

// CommandToken は共有 pub/sub プリミティブ Token の薄い特化。
// instanceof による型判別を成立させるため独立クラスとして維持する。
//
export class CommandToken extends Token implements ICommandToken {
  /**
   * 属する state 要素（devtools のツリー識別 — protocol v2 追補）。
   * registry（getOrCreateCommandToken）経由の生成でのみ渡る optional 参照で、
   * token の寿命は registry 側の WeakMap が state 要素に紐づけている（ここが
   * 寿命を延ばす新しい経路にはならない）。emit の payload にだけ載せる。
   */
  private _stateElement: IStateElement | undefined;

  constructor(name: string, stateElement?: IStateElement) {
    super(name);
    this._stateElement = stateElement;
  }

  emit(...args: unknown[]): unknown[] {
    if (devtoolsSink !== null) {
      // subscriberCount 0 の emit（空撃ち）もそのまま流す — whenDefined 前の
      // command 空撃ちレース類をタイムラインで可視化するため
      devtoolsSink({
        type: "state:token-emit",
        kind: "command",
        tokenName: this.name,
        args,
        subscriberCount: this.size,
        stateElement: this._stateElement,
      });
    }
    return super.emit(...args);
  }
}

export function isCommandToken(value: unknown): value is ICommandToken {
  return value instanceof CommandToken;
}
