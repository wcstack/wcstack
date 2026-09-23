/**
 * captureHandlerRejection.ts
 *
 * state 側ハンドラ（`$on` の event-token subscriber、`onXxx:` の state メソッド、
 * DOM イベント起点の command-token emit）の戻り値を受け取り、Promise が混ざって
 * いれば reject を捕捉して報告する。
 *
 * なぜ必要か:
 * 発火経路はハンドラの完了を待たない。戻り値は `Token.emit` の結果配列にしか現れず、
 * 呼び出し側（eventTokenHandler / handler）はそれを捨てている。そのため **async
 * ハンドラが reject すると unhandled rejection になり**、しかも「どのハンドラで
 * 落ちたか」の手掛かりがスタックにしか残らない（特性化:
 * `__tests__/poc.asyncOnLoopContext.test.ts`）。
 *
 * 握り潰しではない:
 * 可視性は `console.error` で保たれ、state 名・ハンドラ名が付く分むしろ特定は容易に
 * なる。非同期の失敗を「例外の伝播」ではなく「診断可能な報告」に落とすのは
 * never-throw（async-io-node-guidelines.md §3.6）と同じ方針であり、I/O ノードが
 * `error` プロパティへ流すのと同じ位置づけの、state 側ハンドラ版にあたる。
 *
 * **同期 throw の扱いは発火経路で違う。** 同期に呼ぶ経路（twoway / radio / checkbox の
 * `createState`、state 側からの `Token.emit`）では従来どおり呼び出し元へ伝播する。
 * DOM イベント起点（`event/handler.ts`）は `createStateAsync` を使うので、ハンドラの同期 throw も
 * `async` 関数の中で reject に変わり、**呼び出し元（DOM のイベント配送）には届かない** —
 * 捨てると unhandled rejection になるだけなので、`reportHandlerError` で報告へ落とす。
 * プログラマエラーを loud に落とす `raiseError` の意図（見えること）はそれで保たれる。
 */

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * @param result   ハンドラ呼び出しの戻り値。`Token.emit` の結果配列（subscriber ごとの
 *                 戻り値）と、単一ハンドラの戻り値の両方を受ける。
 * @param describe 報告に載せるハンドラの識別名（例: `$on."rowFailed" of state "default"`）。
 */
/**
 * ハンドラの失敗を報告する（発火経路が呼び出し元へ投げ返せないとき）。
 * 文言は `captureHandlerRejection` と同じ形にして、報告の出どころを 1 つに保つ。
 */
export function reportHandlerError(error: unknown, describe: string): void {
  console.error(`[wcstack/state] ${describe} rejected.`, error);
}

export function captureHandlerRejection(result: unknown, describe: string): void {
  // emit は subscriber ごとの戻り値配列。単一ハンドラの戻り値はそのまま届く。
  const values = Array.isArray(result) ? result : [result];
  for (const value of values) {
    if (!isThenable(value)) {
      continue;
    }
    // Promise.resolve は native Promise をそのまま返すため、catch の登録によって
    // 元の Promise が handled になる（thenable は同値の Promise に包まれる）。
    Promise.resolve(value).catch((error: unknown) => reportHandlerError(error, describe));
  }
}
