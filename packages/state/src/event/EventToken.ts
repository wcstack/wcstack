import { devtoolsSink } from "../devtools/sink";
import { Token } from "../token/Token";

// EventToken は共有 pub/sub プリミティブ Token の薄い特化（element→state 方向）。
// instanceof による型判別を成立させるため独立クラスとして維持する。
//
// ownerStateName は devtools 計装（protocol §4.5）のための内部 optional 引数。
// event-token-protocol の外部仕様は不変更。
export class EventToken extends Token {
  private _ownerStateName: string | null;

  constructor(name: string, ownerStateName?: string) {
    super(name);
    this._ownerStateName = ownerStateName ?? null;
  }

  emit(...args: unknown[]): unknown[] {
    if (devtoolsSink !== null) {
      devtoolsSink({
        type: "state:token-emit",
        kind: "event",
        stateName: this._ownerStateName,
        tokenName: this.name,
        args,
        subscriberCount: this.size,
      });
    }
    return super.emit(...args);
  }
}

export function isEventToken(value: unknown): value is EventToken {
  return value instanceof EventToken;
}
