/**
 * scan/eventReset.ts
 *
 * `on` scan の `resetOn` を「書き込みの時点」で効かせる台帳（docs/state-scan-design.md D6）。
 *
 * `on` の fold は出来事のその場で同期に書く。一方 `resetOn` のパスはバッチに載って drain の
 * 終わりにしか見えない。drain で reset するだけだと、reset の書き込みから drain までに起きた
 * 出来事 — その書き込みの binding 適用で要素が同期に dispatch したものを含む — まで消える。
 *
 * そこで reset の要求を enqueue の時点で entry に保留する。
 * - 保留中に来た出来事の fold は `initial` から畳み、保留を消す。
 * - 保留が残ったまま drain に来たら、scan runtime が出力を `initial` に戻して保留を消す。
 * これで「書き込みより後の出来事は reset 後の出力に畳まれる」順序になる。
 *
 * updater（enqueue 側）から呼ばれるので updater を import しない（watch/chainDepth.ts と同じ理由）。
 */

import type { IAbsoluteStateAddress } from "../address/types";
import { getActiveWatchStateElements } from "../watch/watchRegistry";
import { getScanEventResetRegistryCount, getScanRegistry } from "./scanRegistry";
import type { IScanEntry } from "./types";

const pendingResets: WeakSet<IScanEntry> = new WeakSet();

/**
 * 書き込みの enqueue を記録する（updater 専用）。
 * `resetOn` を持つ `on` scan がページに 1 つも無ければ、整数比較 1 回で抜ける。
 */
export function noteEnqueueForScanReset(absAddress: IAbsoluteStateAddress): void {
  if (getScanEventResetRegistryCount() === 0) {
    return;
  }
  const stateElement = absAddress.absolutePathInfo.stateElement;
  // 発火対象でない state（切断中・初期化中・SSR）の書き込みは reset しない — drain 側と同じ扱い
  if (!getActiveWatchStateElements().has(stateElement)) {
    return;
  }
  const entries = getScanRegistry(stateElement)?.eventResetByPath.get(absAddress.absolutePathInfo.pathInfo.path);
  if (typeof entries === "undefined") {
    return;
  }
  for (const entry of entries) {
    pendingResets.add(entry);
  }
}

export function hasPendingScanReset(entry: IScanEntry): boolean {
  return pendingResets.has(entry);
}

/** 保留があれば消して true を返す。 */
export function consumePendingScanReset(entry: IScanEntry): boolean {
  return pendingResets.delete(entry);
}
