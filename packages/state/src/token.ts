/**
 * The command-token / event-token pub/sub primitive (the same shape as @wcstack/state's
 * `Token`). A subscriber that throws is reported and the others still receive the call.
 */
import { raise, M, text } from "./messages";

export type TokenSubscriber = (...args: unknown[]) => unknown;

export class Token {
  readonly name: string;
  private readonly subscribers = new Set<TokenSubscriber>();

  constructor(name: string) {
    this.name = name;
  }

  get size(): number {
    return this.subscribers.size;
  }

  subscribe(fn: TokenSubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  unsubscribe(fn: TokenSubscriber): boolean {
    return this.subscribers.delete(fn);
  }

  emit(...args: unknown[]): unknown[] {
    const results: unknown[] = [];
    for (const fn of this.subscribers) {
      try {
        results.push(fn(...args));
      } catch (error) {
        results.push(undefined);
        console.error(`[@wcstack/state] ${text(M.TokenSubscriberThrew, [this.name])}`, error);
      }
    }
    return results;
  }
}

function readNames(value: unknown, key: string, reserved?: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) raise(M.TokenListNotArray, [key]);
  const seen = new Set<string>();
  for (const name of value) {
    if (typeof name !== "string" || name === "") raise(M.TokenEntryEmpty, [key]);
    if (name === reserved) raise(M.TokenEntryReserved, [key, name, reserved]);
    if (seen.has(name)) raise(M.TokenEntryDuplicated, [key, name]);
    seen.add(name);
  }
  return value as string[];
}

/**
 * `$commandTokens` → the frozen `$command` namespace (name → Token). On a re-set, a name
 * the previous state declared keeps its token: elements subscribed to it keep receiving.
 */
export function commandNamespace(target: Record<string, any>, prev?: Readonly<Record<string, Token>>): Readonly<Record<string, Token>> {
  const ns: Record<string, Token> = {};
  for (const name of readNames(target.$commandTokens, "$commandTokens", "$command")) ns[name] = prev?.[name] ?? new Token(name);
  return Object.freeze(ns);
}

/**
 * `$eventTokens` + `$on` → name → Token, with each `$on` handler subscribed as
 * `(state, event, ...listIndexes)` through `deliver`.
 */
export function eventTokens(
  target: Record<string, any>,
  deliver: (handler: (...args: unknown[]) => unknown, args: unknown[]) => unknown,
): Map<string, Token> {
  const tokens = new Map<string, Token>();
  for (const name of readNames(target.$eventTokens, "$eventTokens")) tokens.set(name, new Token(name));
  const on = target.$on;
  if (on === undefined) return tokens;
  if (on === null || typeof on !== "object") raise(M.OnNotObject);
  for (const [name, handler] of Object.entries(on)) {
    const token = tokens.get(name);
    if (token === undefined) raise(M.OnEntryUndeclared, [name]);
    if (typeof handler !== "function") raise(M.OnEntryNotFunction, [name]);
    token.subscribe((...args) => deliver(handler as (...a: unknown[]) => unknown, args));
  }
  return tokens;
}
