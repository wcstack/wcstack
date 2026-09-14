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
 * - 保留中に来た出来事の fold は `initial` から畳み、出力の書き込みが通ったら保留を消す
 *   （fold の throw・thenable・書き込みの throw なら残す）。
 * - 保留が残ったまま drain に来たら、scan runtime が出力を `initial` に戻して保留を消す。
 * これで「書き込みより後の出来事は reset 後の出力に畳まれる」順序になる。
 *
 * 保留は「その書き込みが載ったバッチの drain で initial に戻す」予約なので、寿命をそのバッチに
 * 揃える。drain がそのバッチの scan を発火しない（書き込みの後・drain の前に切断された・連鎖深さの
 * 上限で打ち切った・先行 fold が同期に切断や再セットをした）なら保留を捨てる。残すと、後の無関係な
 * 出来事が突然 `initial` から畳み始める。同じ条件の `from` の scan は reset しない（発火しない）ので、
 * それに揃える。保留は entry ごとの 1 bit でどのバッチの書き込みかを持たないので、同じ `resetOn` の
 * パスが次のバッチ向けに既に積まれていれば捨てない — その保留は次のバッチの drain が使う。
 *
 * updater（enqueue 側）から呼ばれるので updater を import しない（watch/chainDepth.ts と同じ理由）。
 */

import type { IAbsoluteStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import { getScanEventResetGateCount, getScanRegistry, hasActiveScanEventReset } from "./scanRegistry";
import type { IScanEntry } from "./types";

const pendingResets: WeakSet<IScanEntry> = new WeakSet();

/**
 * 保留中の entry の数。捨てる走査（discardPendingScanResets）のゲート。保留は enqueue の直後の drain で
 * 使うか捨てるか次のバッチへ持ち越すので、ふつうは 0。enqueue のゲート（発火対象の state）と別に持つのは、
 * 書き込みの後・drain の前に切断された state がゲートから外れても、その保留は drain で捨てるため。
 */
let pendingResetCount = 0;

/** このアドレスを `resetOn` に持つ `on` scan（無ければ undefined） */
function eventResetEntriesAt(absAddress: IAbsoluteStateAddress): readonly IScanEntry[] | undefined {
  return getScanRegistry(absAddress.absolutePathInfo.stateElement)
    ?.eventResetByPath.get(absAddress.absolutePathInfo.pathInfo.path);
}

/**
 * 書き込みの enqueue を記録する（updater 専用）。
 * `resetOn` を持つ `on` scan が発火対象の state に 1 つも無ければ（そうした state を DOM から外した後を含む）、
 * 整数比較 1 回で抜ける。
 */
export function noteEnqueueForScanReset(absAddress: IAbsoluteStateAddress): void {
  if (getScanEventResetGateCount() === 0) {
    return;
  }
  // 発火対象でない state（切断中・初期化中・SSR）の書き込みは reset しない — drain 側と同じ扱い
  if (!hasActiveScanEventReset(absAddress.absolutePathInfo.stateElement)) {
    return;
  }
  const entries = eventResetEntriesAt(absAddress);
  if (typeof entries === "undefined") {
    return;
  }
  for (const entry of entries) {
    markPendingScanReset(entry);
  }
}

/**
 * 保留を立てる。enqueue の記録（上）と、`_state` 再セットで旧宣言の保留を同じ出力の `on` scan へ
 * 引き継ぐとき（processScanDeclaration.ts の registerScans）だけが呼ぶ。
 */
export function markPendingScanReset(entry: IScanEntry): void {
  if (!pendingResets.has(entry)) {
    pendingResets.add(entry);
    pendingResetCount++;
  }
}

export function hasPendingScanReset(entry: IScanEntry): boolean {
  return pendingResets.has(entry);
}

/** 保留があれば消して true を返す。 */
export function consumePendingScanReset(entry: IScanEntry): boolean {
  if (!pendingResets.delete(entry)) {
    return false;
  }
  pendingResetCount--;
  return true;
}

/** 保留中の entry の数（テストと診断用）。 */
export function getPendingScanResetCount(): number {
  return pendingResetCount;
}

/**
 * drain がバッチの scan を発火しないとき、そのバッチが載せた保留を捨てる。
 * `firing` はこの drain で scan を発火する state の集合。null はバッチ全体を発火しない
 * （連鎖深さの上限）。`isQueued` は「次のバッチ向けに、この state のこのパスが積まれているか」
 * （updater を import しないので呼び出し側から受け取る）。
 */
export function discardPendingScanResets(
  batch: ReadonlySet<IAbsoluteStateAddress>,
  firing: ReadonlySet<IStateElement> | null,
  isQueued: (stateElement: IStateElement, path: string) => boolean,
): void {
  if (pendingResetCount === 0) {
    return;
  }
  for (const absAddress of batch) {
    const stateElement = absAddress.absolutePathInfo.stateElement;
    if (firing?.has(stateElement) === true) {
      continue;
    }
    const entries = eventResetEntriesAt(absAddress);
    if (typeof entries === "undefined") {
      continue;
    }
    for (const entry of entries) {
      if (!entry.resetOn.some((path) => isQueued(stateElement, path))) {
        consumePendingScanReset(entry);
      }
    }
  }
}
