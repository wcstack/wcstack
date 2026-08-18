/**
 * watch/watchRuntime.ts
 *
 * `$watch` の発火（docs/state-watch-hook-design.md §3 / §7）。
 *
 * updater の drain 終了フックに 1 つだけリスナーを登録し、バッチに載った絶対アドレスと
 * 宣言済み watch パスを突き合わせて発火する。**binding の有無に関係なくバッチへ載る**ので、
 * これが headless 購読の実体になる（binding 駆動の `$updatedCallback` との違い）。
 *
 * 実行順序（設計書 §3-2）:
 * - 機構間は優先度で固定（`$updatedCallback` → `$watch` → `$streams` restart）。
 *   `$updatedCallback` が先なのは binding 適用ループの内側で呼ばれる構造的必然。
 * - watch ハンドラ間は `$watch` の宣言順（entry.order）。利用者が順序に意思を持てる唯一の層。
 * - 同一パスの複数行は indexes 昇順。
 *
 * 収集と発火を 2 相に分ける理由:
 * 1. ハンドラ内の書き込みが registry / active 集合を同期的に変えうる（`_state` 再 set・切断）
 *    ため、発火直前に live 再チェックが要る（`$streams` の restart hits と同型）。
 * 2. 上記の順序規約のために hits をソートする必要がある（バッチの反復順は enqueue 順）。
 */

import type { IAbsoluteStateAddress } from "../address/types";
import type { IStateElement } from "../components/types";
import { MAX_WATCH_CHAIN_DEPTH, WATCH_LISTENER_PRIORITY } from "../define";
import { getScopedIndexes } from "../list/wildcardLevel";
import type { IStateProxy } from "../proxy/types";
import { registerUpdateBatchListener } from "../updater/updater";
import { beginWatchFiring, consumeWatchChainDepth, endWatchFiring } from "./chainDepth";
import { clearPrevValues, getPrevValue } from "./prevValues";
import { addActiveWatchStateElement, getActiveWatchStateElements, getWatchEntries } from "./watchRegistry";
import type { IWatchEntry } from "./types";

interface IWatchHit {
  readonly stateElement: IStateElement;
  readonly entry: IWatchEntry;
  readonly absAddress: IAbsoluteStateAddress;
  readonly indexes: number[];
}

/**
 * この stateElement の `$watch` を有効化する（`State.connectedCallback` ／接続中の
 * `_state` 再 set から呼ばれる。無効化は `clearWatchRegistry`）。
 *
 * `addActiveWatchStateElement` の薄いラッパだが、**State が runtime を import する
 * 経路をここに一本化する**意味がある: drain リスナーの登録はこのモジュールの
 * 初期化副作用なので、registry だけを import すると発火機構ごと落ちる。
 * `$streams` の `startStreams` と対称の位置づけ。
 */
export function startWatch(stateElement: IStateElement): void {
  addActiveWatchStateElement(stateElement);
}

function fireWatchOnUpdateBatch(batch: ReadonlySet<IAbsoluteStateAddress>): void {
  const activeStateElements = getActiveWatchStateElements();
  if (activeStateElements.size === 0) {
    // watch 未使用アプリの drain に配列・イテレータ割り当てのコストを載せない
    return;
  }
  try {
    const depth = consumeWatchChainDepth();
    if (depth > MAX_WATCH_CHAIN_DEPTH) {
      // 打ち切るのは watch の発火のみ。値と binding 適用は巻き戻さない
      // （伝播 hop 上限超過時の quarantine と同じ姿勢、§7-2）。
      console.error(
        `[@wcstack/state] $watch chain depth limit exceeded; watch handlers for this batch were skipped.`,
        {
          maxDepth: MAX_WATCH_CHAIN_DEPTH,
          paths: Array.from(batch, (absAddress) => absAddress.absolutePathInfo.pathInfo.path),
        },
      );
      return;
    }

    // --- 収集フェーズ ---
    const hits: IWatchHit[] = [];
    for (const absAddress of batch) {
      // stateName 文字列ではなく stateElement 参照で引く。AbsolutePathInfo は
      // stateElement 単位でキャッシュされるので、同名 state が複数の rootNode に
      // 居ても取り違えない（address/AbsolutePathInfo.ts）。他 state のアドレスは
      // ここで自然に落ちる ＝ 越境しない（設計 D8）。
      const stateElement = absAddress.absolutePathInfo.stateElement;
      if (!activeStateElements.has(stateElement)) {
        continue;
      }
      const entry = getWatchEntries(stateElement).get(absAddress.absolutePathInfo.pathInfo.path);
      if (typeof entry === "undefined") {
        continue;
      }
      const indexes = (entry.pathInfo.wildcardCount > 0 && absAddress.listIndex !== null)
        ? getScopedIndexes(absAddress.listIndex, entry.pathInfo.wildcardCount)
        : [];
      hits.push({ stateElement, entry, absAddress, indexes });
    }
    if (hits.length === 0) {
      return;
    }
    hits.sort(compareHits);

    // --- 発火フェーズ ---
    beginWatchFiring(depth);
    try {
      for (const hit of hits) {
        // 先行ハンドラが同期的に切断や `_state` 再 set を行い得るため、発火直前に
        // 「まだ active か」「entry が現行 registry のものか」を再確認する。
        if (
          !activeStateElements.has(hit.stateElement) ||
          getWatchEntries(hit.stateElement).get(hit.entry.path) !== hit.entry
        ) {
          continue;
        }
        fireOne(hit);
      }
    } finally {
      endWatchFiring();
    }
  } finally {
    // 旧値台帳はこの drain 限りのもの。次のバッチへ持ち越さない（§4-1）。
    clearPrevValues();
  }
}

/**
 * 層 2（宣言順）→ 層 3（indexes 昇順）の順に比較する（設計書 §3-3）。
 */
function compareHits(a: IWatchHit, b: IWatchHit): number {
  if (a.entry.order !== b.entry.order) {
    return a.entry.order - b.entry.order;
  }
  const length = Math.min(a.indexes.length, b.indexes.length);
  for (let i = 0; i < length; i++) {
    if (a.indexes[i] !== b.indexes[i]) {
      return a.indexes[i] - b.indexes[i];
    }
  }
  return a.indexes.length - b.indexes.length;
}

/**
 * ハンドラ 1 つを発火する。**例外はここで閉じる**（設計書 §7-1）。
 *
 * drain リスナーの throw は握りつぶさない契約（updater.ts）なので、watch 側で捕まえないと
 * 1 つのユーザー例外が他の watch と `$streams` の restart を巻き添えにする。
 * `$connectedCallback` / `$updatedCallback` の loud fail とは意図的に異なる扱い。
 */
function fireOne(hit: IWatchHit): void {
  const { stateElement, entry, absAddress, indexes } = hit;
  try {
    stateElement.createState("writable", (state) => {
      const cur = readCurrentValue(state, entry, indexes);
      const prev = getPrevValue(absAddress);
      entry.handler.call(state, cur, prev, ...indexes);
    });
  } catch (e) {
    console.error(`[@wcstack/state] $watch handler for "${entry.path}" threw.`, e);
  }
}

function readCurrentValue(state: IStateProxy, entry: IWatchEntry, indexes: number[]): unknown {
  if (entry.pathInfo.wildcardCount === 0) {
    return state[entry.path];
  }
  // ワイルドカードを含むパスは素の読みでは解決できない。getScopedIndexes が返した列は
  // そのまま $resolve の引数として使える（list/wildcardLevel.ts の往復契約）。
  return state.$resolve(entry.path, indexes);
}

// 優先度で `$streams` の restart より先に固定する（設計書 §3-2 層 1）。import 順には依存しない。
registerUpdateBatchListener(fireWatchOnUpdateBatch, WATCH_LISTENER_PRIORITY);

export const __private__ = {
  fireWatchOnUpdateBatch,
  compareHits,
};
