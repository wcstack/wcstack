import { devtoolsSink } from "../devtools/sink";
import { Token } from "../token/Token";
import { ICommandToken } from "./types";

// CommandToken は共有 pub/sub プリミティブ Token の薄い特化。
// instanceof による型判別を成立させるため独立クラスとして維持する。
//
// ownerStateName は devtools 計装（protocol §4.5）のための内部 optional 引数。
// command-token-protocol の外部仕様は不変更（registry が渡すだけで、
// subscribe/emit の意味論には一切影響しない）。
export class CommandToken extends Token implements ICommandToken {
  private _ownerStateName: string | null;

  constructor(name: string, ownerStateName?: string) {
    super(name);
    this._ownerStateName = ownerStateName ?? null;
  }

  emit(...args: unknown[]): unknown[] {
    if (devtoolsSink !== null) {
      // subscriberCount 0 の emit（空撃ち）もそのまま流す — whenDefined 前の
      // command 空撃ちレース類をタイムラインで可視化するため
      devtoolsSink({
        type: "state:token-emit",
        kind: "command",
        stateName: this._ownerStateName,
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
