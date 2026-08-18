/**
 * watch/chainDepth.ts
 *
 * `$watch` ハンドラ起点の書き込み連鎖の深さを数える台帳
 * （docs/state-watch-hook-design.md §7-2）。
 *
 * watch ハンドラ内の書き込みは新しい microtask バッチを作るため、伝播 context の
 * hop 上限（MAX_PROPAGATION_HOPS）のガードが効かない。かつ書き込み先が動的なので、
 * `$streams` のような「宣言時の自己依存検出」も使えない。よって実行時に数える。
 *
 * updater（enqueue 側）と watchRuntime（発火側）の両方から参照されるため、
 * **依存ゼロの葉モジュール**にして循環 import を避ける（devtools/sink.ts と同じ方針）。
 *
 * 数え方: ハンドラ実行中に enqueue が起きたときだけ「次のバッチはこの連鎖の続き」と
 * マークする。ハンドラが何も書かなければ次のバッチは深さ 0 に戻るので、利用者操作が
 * 何度続いても深さは伸びない。
 */

/** ハンドラ実行中に立つ「今の連鎖の深さ + 1」。0 なら watch 起点ではない */
let firingDepth = 0;

/** 次に drain されるバッチの深さ */
let pendingDepth = 0;

/** watch の発火フェーズ開始（watchRuntime 専用） */
export function beginWatchFiring(depth: number): void {
  firingDepth = depth + 1;
}

/** watch の発火フェーズ終了（watchRuntime 専用。必ず finally で呼ぶ） */
export function endWatchFiring(): void {
  firingDepth = 0;
}

/**
 * 書き込みの enqueue を記録する（updater 専用）。
 * ハンドラ実行中でなければ何もしない ＝ 通常の書き込みに深さは付かない。
 */
export function noteEnqueueForWatchChain(): void {
  if (firingDepth > pendingDepth) {
    pendingDepth = firingDepth;
  }
}

/** 次バッチの深さを消費する（watchRuntime 専用。読んだらリセット） */
export function consumeWatchChainDepth(): number {
  const depth = pendingDepth;
  pendingDepth = 0;
  return depth;
}

export const __private__ = {
  reset(): void {
    firingDepth = 0;
    pendingDepth = 0;
  },
};
