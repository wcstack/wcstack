import { CommandSubscriber, ICommandToken } from "./types";

// _subscribers は Set のため挿入順を保持する。
// emit() は subscribe() された順に呼び出され、戻り値配列も同じ順序で返る。
export class CommandToken implements ICommandToken {
  private _name: string;
  private _subscribers: Set<CommandSubscriber> = new Set();

  constructor(name: string) {
    this._name = name;
  }

  get name(): string {
    return this._name;
  }

  get size(): number {
    return this._subscribers.size;
  }

  subscribe(fn: CommandSubscriber): () => void {
    this._subscribers.add(fn);
    return () => {
      this._subscribers.delete(fn);
    };
  }

  unsubscribe(fn: CommandSubscriber): boolean {
    return this._subscribers.delete(fn);
  }

  emit(...args: unknown[]): unknown[] {
    const results: unknown[] = [];
    for (const fn of this._subscribers) {
      results.push(fn(...args));
    }
    return results;
  }
}

export function isCommandToken(value: unknown): value is ICommandToken {
  return value instanceof CommandToken;
}
