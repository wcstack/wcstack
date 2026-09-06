/**
 * watch/prevValues.ts
 *
 * `$watch` ハンドラへ渡す `prev`（バッチ開始時点の値）の台帳
 * （docs/state-watch-hook-design.md §4-1）。
 *
 * 記録するのは **watch 宣言済みパスへの書き込みだけ**、かつ **バッチ内で最初の 1 回だけ**
 * （first-write-wins）。したがって `prev` は「そのバッチが始まる前の値」、`cur` は
 * drain 時点の確定値になる。同一バッチ内の中間値は観測できない（§3-4）。
 *
 * 値の出どころは same-value guard が既に読んでいる旧値であり、watch のために
 * 追加の getByAddress は行わない（§10）。その帰結として:
 * - 参照型（object / array）は guard が素通しするので `prev` は undefined
 * - `config.sameValueGuard = false` でも undefined
 * - `$postUpdate` / stream の status 通知は setByAddress を通らないので undefined
 *
 * 台帳は drain 終端（watchRuntime）でクリアされる。drain の外で書き込まれた分が
 * 次のバッチへ持ち越されることはない。
 */

import type { IAbsoluteStateAddress } from "../address/types";

const prevValueByAbsoluteStateAddress: Map<IAbsoluteStateAddress, unknown> = new Map();

/**
 * バッチ内で最初の書き込みのときだけ旧値を記録する（first-write-wins）。
 */
export function recordPrevValue(absAddress: IAbsoluteStateAddress, oldValue: unknown): void {
  if (prevValueByAbsoluteStateAddress.has(absAddress)) {
    return;
  }
  prevValueByAbsoluteStateAddress.set(absAddress, oldValue);
}

/**
 * 記録済みの旧値を返す。記録が無ければ undefined（§4-1 の「prev を保証しない」経路）。
 */
export function getPrevValue(absAddress: IAbsoluteStateAddress): unknown {
  return prevValueByAbsoluteStateAddress.get(absAddress);
}

/**
 * 台帳をクリアする（drain 終端で必ず呼ぶ）。
 */
export function clearPrevValues(): void {
  prevValueByAbsoluteStateAddress.clear();
}

export const __private__ = {
  prevValueByAbsoluteStateAddress,
};
