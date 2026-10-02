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
 * **依存ゼロの葉モジュール**にして循環 import を避ける（platform/devtoolsSink.ts と同じ方針。型の import だけ）。
 *
 * 数え方: ハンドラ実行中に enqueue された書き込みだけに「そのハンドラの深さ + 1」を付ける。深さは
 * **書き込み（アドレス）ごと**に持ち、次のバッチの各ハンドラ（`$scan` なら group）は、自分を起こした
 * 書き込みの深さで発火する。ハンドラが何も書かなければ深さは付かないので、利用者操作が何度続いても
 * 深さは伸びない。バッチ単位で持つと、ハンドラの書き込みと同じバッチに相乗りした別の書き込み
 * （`$renderedCallback` の書き戻しなど）で起きたハンドラまで連鎖の続きに数え、有限の描画の連鎖が
 * 32 段を超えたところで誤って打ち切っていた（#354）。
 *
 * `$stream` の再開（drain 終了リスナーの中の `initial` と status の書き込み）もハンドラと同じく、再開を起こした
 * 書き込みの深さで数える（stream/streamRuntime.ts）。
 *
 * 台帳は drain ごとに必ず消費する（watch runtime のリスナーの先頭）。消費した深さはそのバッチ（drain 終了
 * リスナーへ渡る Set）に結び付けて弱く持つ — `$scan` / `$watch` と、後から呼ばれる `$stream` の再開の
 * リスナーが同じバッチで引け、drain が終われば台帳ごと捨てられる。発火する state が無い drain で消費しないと、外れた state のハンドラが
 * 書いたアドレスと深さが残り続け、後の別の state のバッチの深さに効いていた。
 */
import type { IAbsoluteStateAddress } from "../address/types";

/** ハンドラ実行中に立つ「今の連鎖の深さ + 1」。0 なら watch 起点ではない */
let firingDepth = 0;

/** 次に drain されるバッチの、ハンドラ起点の書き込みの深さ。載っていない書き込みは深さ 0。何も無ければ null（割り当てない） */
let pendingDepths: Map<IAbsoluteStateAddress, number> | null = null;

/** pendingDepths の深さの最大（台帳が null なら 0） */
let pendingDeepest = 0;

/** 消費した深さ（バッチごと）。バッチが捨てられれば一緒に捨てられる */
const depthsByBatch = new WeakMap<ReadonlySet<IAbsoluteStateAddress>, ReadonlyMap<IAbsoluteStateAddress, number>>();

/** watch の発火開始（watchRuntime / scanRuntime / streamRuntime 専用）。`depth` はこれから発火するハンドラを起こした書き込みの深さ */
export function beginWatchFiring(depth: number): void {
  firingDepth = depth + 1;
}

/** watch の発火フェーズ終了（watchRuntime / scanRuntime / streamRuntime 専用。必ず finally で呼ぶ） */
export function endWatchFiring(): void {
  firingDepth = 0;
}

/**
 * 書き込みの enqueue を記録する（updater 専用）。
 * ハンドラ実行中でなければ何もしない ＝ 通常の書き込みに深さは付かない。
 */
export function noteEnqueueForWatchChain(absoluteAddress: IAbsoluteStateAddress): void {
  if (firingDepth > 0) {
    const depths = (pendingDepths ??= new Map());
    if (firingDepth > (depths.get(absoluteAddress) ?? 0)) {
      depths.set(absoluteAddress, firingDepth);
    }
    pendingDeepest = Math.max(pendingDeepest, firingDepth);
  }
}

/**
 * drain 中のバッチの書き込みごとの深さを消費し、その最大を返す（watchRuntime 専用。drain ごとに必ず 1 回・
 * 読んだらリセット）。このバッチのハンドラの書き込みは新しい台帳へ載り、読み途中の台帳を変えない。
 * 何も付いていなければ割り当ては無い。
 */
export function consumeWatchChainDepths(batch: ReadonlySet<IAbsoluteStateAddress>): number {
  const deepest = pendingDeepest;
  if (deepest > 0) {
    depthsByBatch.set(batch, pendingDepths!);
    pendingDepths = null;
    pendingDeepest = 0;
  }
  return deepest;
}

/** 消費済みのバッチの、書き込み 1 つの深さ（付いていなければ 0） */
export function watchChainDepthOf(batch: ReadonlySet<IAbsoluteStateAddress>, absoluteAddress: IAbsoluteStateAddress): number {
  return depthsByBatch.get(batch)?.get(absoluteAddress) ?? 0;
}

export const __private__ = {
  reset(): void {
    firingDepth = 0;
    pendingDepths = null;
    pendingDeepest = 0;
  },
};
