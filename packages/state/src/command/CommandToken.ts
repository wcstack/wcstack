import { Token } from "../token/Token";
import { ICommandToken } from "./types";

// CommandToken は共有 pub/sub プリミティブ Token の薄い特化。
// instanceof による型判別を成立させるため独立クラスとして維持する。
export class CommandToken extends Token implements ICommandToken {
}

export function isCommandToken(value: unknown): value is ICommandToken {
  return value instanceof CommandToken;
}
