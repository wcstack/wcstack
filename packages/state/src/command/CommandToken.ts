import { devtoolsSink } from "../devtools/sink";
import { Token } from "../token/Token";
import { ICommandToken } from "./types";

// CommandToken は共有 pub/sub プリミティブ Token の薄い特化。
// instanceof による型判別を成立させるため独立クラスとして維持する。
//
export class CommandToken extends Token implements ICommandToken {
  constructor(name: string) {
    super(name);
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
      });
    }
    return super.emit(...args);
  }
}

export function isCommandToken(value: unknown): value is ICommandToken {
  return value instanceof CommandToken;
}
