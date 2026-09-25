/**
 * The command-token / event-token pub/sub primitive (the same shape as @wcstack/state's
 * `Token`). A subscriber that throws is reported and the others still receive the call.
 */
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
        console.error(`[@wcstack/state] a subscriber of token "${this.name}" threw; the remaining subscribers still received it.`, error);
      }
    }
    return results;
  }
}

function readNames(value: unknown, key: string, reserved?: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array of strings.`);
  const seen = new Set<string>();
  for (const name of value) {
    if (typeof name !== "string" || name === "") throw new Error(`${key} entries must be non-empty strings.`);
    if (name === reserved) throw new Error(`${key} entry "${name}" conflicts with the reserved namespace name "${reserved}".`);
    if (seen.has(name)) throw new Error(`${key} entry "${name}" is duplicated.`);
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
  if (on === null || typeof on !== "object") throw new Error("$on must be an object mapping event-token names to handler functions.");
  for (const [name, handler] of Object.entries(on)) {
    const token = tokens.get(name);
    if (token === undefined) throw new Error(`$on entry "${name}" is not declared in $eventTokens.`);
    if (typeof handler !== "function") throw new Error(`$on entry "${name}" must be a function.`);
    token.subscribe((...args) => deliver(handler as (...a: unknown[]) => unknown, args));
  }
  return tokens;
}
