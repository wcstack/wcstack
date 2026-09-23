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

  /**
   * 全 subscriber へ配る。**1 つが throw しても残りへ配り続ける** — トークンはファンアウトの
   * 口で、購読者どうしは互いを知らない（README の「click fans the command out to every
   * subscriber」の例は、片方の要素が投げたらもう片方に届かない形では成り立たない）。
   * 投げた分は握り潰さず `console.error` に載せ、結果配列にはその位置を `undefined` で残す。
   *
   * 握り潰しでないことの根拠は `event/captureHandlerRejection.ts` と同じ: 発火経路は
   * ハンドラの完了を待たず、DOM イベント起点では例外を呼び出し元へ投げ返せない。
   * 「例外の伝播」ではなく「診断可能な報告」に落とすのが state 側ハンドラの方針。
   */
  emit(...args: unknown[]): unknown[] {
    const results: unknown[] = [];
    for (const fn of this._subscribers) {
      try {
        results.push(fn(...args));
      } catch (error) {
        results.push(undefined);
        console.error(`[wcstack/state] a subscriber of token "${this.name}" threw; the remaining subscribers still received it.`, error);
      }
    }
    return results;
  }
}
