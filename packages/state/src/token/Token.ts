// command-token / event-token が共有する pub/sub プリミティブ。
// _subscribers は Set のため挿入順を保持する。
// emit() は subscribe() された順に呼び出され、戻り値配列も同じ順序で返る。
//
// 「誰が subscribe し誰が emit するか」だけが command / event の違い:
//   - command-token: element が subscribe / state が emit
//   - event-token:   state(`$on`) が subscribe / element(listener) が emit

export type TokenSubscriber = (...args: unknown[]) => unknown;

export interface IToken {
  readonly name: string;
  readonly size: number;
  subscribe(fn: TokenSubscriber): () => void;
  unsubscribe(fn: TokenSubscriber): boolean;
  emit(...args: unknown[]): unknown[];
}

export class Token implements IToken {
  private _name: string;
  private _subscribers: Set<TokenSubscriber> = new Set();

  constructor(name: string) {
    this._name = name;
  }

  get name(): string {
    return this._name;
  }

  get size(): number {
    return this._subscribers.size;
  }

  subscribe(fn: TokenSubscriber): () => void {
    this._subscribers.add(fn);
    return () => {
      this._subscribers.delete(fn);
    };
  }

  unsubscribe(fn: TokenSubscriber): boolean {
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
