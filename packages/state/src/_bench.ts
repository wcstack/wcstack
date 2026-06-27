/**
 * _bench.ts — 評議会実験のための計測インフラ（dev/profiling）。
 *
 * - 同値ガード（A1-1）は正式採用済み → フラグは `config.sameValueGuard` に昇格。
 *   ここには発火回数の**プロファイル用カウンタ**（benchCounters）だけが残る。
 * - computed 同値短絡（A1-2）は実測で純損と判明し A4 へ格下げ → 実験フラグとして残置。
 * setByAddress.ts（カウンタ）と walkDependency.ts（A1-2 フラグ）から参照される。
 */
export const benchFlags = {
  /**
   * プロファイル計測モード（既定 false）。true のときだけ同値ガードが benchCounters を更新する。
   * これにより本番ホットパス（既定 false）はカウンタ計測コストを負わない。bench/audit テストが ON にする。
   */
  profile: false,
  /**
   * computed 同値短絡（A1-2・プロトタイプ）。
   * walkDependency が getter 依存ノードに到達したとき再計算し、前値と Object.is 同値なら
   * その getter を起点とする下流伝播を打ち切る（enqueue しない・部分木を展開しない）。
   * 既知の制約: 素朴な eager 再計算のため、ダイヤモンド依存では DFS 順が
   * トポロジカル順を保証せず stale 読みのグリッチが起きうる（要・三色/トポロジカル化）。
   */
  computedShortCircuit: false,
};

export const benchCounters = {
  /** ガードが発火し set/enqueue/walkDependency を丸ごとスキップした回数 */
  guardSkips: 0,
  /** ガード判定したが値が変わっていたため通常処理へ進んだ回数（= old 読み出しコストを払った回数） */
  guardProceeds: 0,
  /** computed 短絡: getter 再計算が同値で下流を枝刈りした回数 */
  shortCircuitPrunes: 0,
  /** computed 短絡: getter 再計算が変化し通常伝播へ進んだ回数 */
  shortCircuitProceeds: 0,
};

export function resetBenchCounters(): void {
  benchCounters.guardSkips = 0;
  benchCounters.guardProceeds = 0;
  benchCounters.shortCircuitPrunes = 0;
  benchCounters.shortCircuitProceeds = 0;
}
