import { Token } from "../token/Token";

// EventToken は共有 pub/sub プリミティブ Token の薄い特化（element→state 方向）。
// instanceof による型判別を成立させるため独立クラスとして維持する。
export class EventToken extends Token {
}

export function isEventToken(value: unknown): value is EventToken {
  return value instanceof EventToken;
}
