import { IAbsoluteStateAddress } from "../address/types";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { peekBindingsForAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { inSsr } from "../config";
import { MAX_PROPAGATION_HOPS } from "../define";
import { runTransition } from "../protocol/transitionRunner";
import { devtoolsSink } from "../devtools/sink";
import { IPropagationContext } from "../propagation/types";
import { IBindingInfo } from "../types";
import { noteEnqueueForWatchChain } from "../watch/chainDepth";

/**
 * drain（_applyChange）終了通知のリスナー（docs/state-streams-design.md §3-2）。
 * バッチ内の更新アドレス（AbsoluteStateAddress のインスタンス同一性で
 * dedup 済みの Set）を受け取る。stream runtime の依存駆動 restart が
 * この通知を交差判定の入力にする。
 */
export type UpdateBatchListener = (batch: ReadonlySet<IAbsoluteStateAddress>) => void;

interface IRegisteredBatchListener {
  readonly listener: UpdateBatchListener;
  readonly priority: number;
}

const updateBatchListeners: IRegisteredBatchListener[] = [];

/**
 * drain 終了リスナーを登録する。
 *
 * `priority` の昇順に呼ばれる（同値は登録順）。機構間の実行順序
 * （`$watch` → `$streams` restart、docs/state-watch-hook-design.md §3-2 層 1）は
 * この優先度で固定する — import 順に順序を持たせると、無関係な import 整理で
 * 静かに壊れるため。定数は define.ts の `*_LISTENER_PRIORITY` を使うこと。
 */
export function registerUpdateBatchListener(listener: UpdateBatchListener, priority = 0): void {
  // 挿入ソート: 同値優先度の中では登録順を保つ（find は最初の「より大きい」要素を指す）
  const index = updateBatchListeners.findIndex((registered) => registered.priority > priority);
  const entry = { listener, priority };
  if (index === -1) {
    updateBatchListeners.push(entry);
  } else {
    updateBatchListeners.splice(index, 0, entry);
  }
}

/**
 * drain 終了リスナーを解除する（テスト間の分離用）。
 */
export function unregisterUpdateBatchListener(listener: UpdateBatchListener): void {
  const index = updateBatchListeners.findIndex((registered) => registered.listener === listener);
  if (index !== -1) {
    updateBatchListeners.splice(index, 1);
  }
}

/**
 * 全リスナーに drain のバッチを優先度順で通知する。
 * リスナーの throw は握りつぶさない（内部バグの隠蔽防止）。
 * stream / watch 側リスナーが entry ごとに自前で try/catch する契約（設計書 §3-2）。
 */
function notifyUpdateBatchListeners(batch: ReadonlySet<IAbsoluteStateAddress>): void {
  // 反復中の register / unregister（ハンドラ内の切断・再 set）に耐えるためコピーする
  for (const registered of updateBatchListeners.slice()) {
    registered.listener(batch);
  }
}

/**
 * 遷移越しの適用が失敗したときの報告。
 *
 * 遷移の中では例外を同期的に呼び出し元へ投げ返せない。今日の drain は
 * queueMicrotask の中で throw する ＝ uncaught として観測されるので、それと同じ
 * 「loud に出す」挙動へ揃える。握り潰すと `$updatedCallback` の throw が黙って
 * 消える（README の 3 層表が定める伝播の契約が破れる）。
 */
function reportDeferredApplyFailure(error: unknown): void {
  queueMicrotask(() => { throw error; });
}

/** queue に積まれる update record（address + 書き込み時点の因果 context） */
interface IQueuedUpdateRecord {
  readonly absoluteAddress: IAbsoluteStateAddress;
  readonly context: IPropagationContext | null;
}

class Updater {
  private _queueUpdateRecords: IQueuedUpdateRecord[] = [];
  constructor() {
  }

  enqueueAbsoluteAddress(
    absoluteAddress: IAbsoluteStateAddress,
    context: IPropagationContext | null = null,
  ): void {
    // `$watch` ハンドラ実行中の書き込みだけを連鎖としてマークする（watch/chainDepth.ts）。
    // ハンドラ実行中でなければ即 return する葉モジュール呼び出し 1 個のコスト。
    noteEnqueueForWatchChain();
    const requireStartProcess = this._queueUpdateRecords.length === 0;
    this._queueUpdateRecords.push({ absoluteAddress, context });
    if (requireStartProcess) {
      queueMicrotask(() => {
        const updateRecords = this._queueUpdateRecords;
        this._queueUpdateRecords = [];
        this._applyChange(updateRecords);
      });
    }
  }

  // テスト用に公開
  testApplyChange(
    absoluteAddresses: IAbsoluteStateAddress[],
    contexts?: readonly (IPropagationContext | null)[],
  ): void {
    this._applyChange(absoluteAddresses.map((absoluteAddress, index) => ({
      absoluteAddress,
      context: contexts?.[index] ?? null,
    })));
  }

  private _applyChange(updateRecords: IQueuedUpdateRecord[]): void {
    // Note: AbsoluteStateAddress はキャッシュされているため、
    // 同一の (stateName, address) は同じインスタンスとなり、
    // Map / Set による重複排除が正しく機能する。
    // coalescing は last-write-wins: 同じ address は最後の update の
    // (値は state 側が既に保持) context をそのまま採用する（設計書 §4.1）。
    // visitedEdges の合成や synthetic transaction への置換は行わない。
    const contextByAbsoluteAddress = new Map<IAbsoluteStateAddress, IPropagationContext | null>();
    for (const record of updateRecords) {
      const previous = contextByAbsoluteAddress.get(record.absoluteAddress);
      if (
        devtoolsSink !== null
        && typeof previous !== "undefined" && previous !== null
        && record.context !== null
        && previous.transactionId !== record.context.transactionId
      ) {
        devtoolsSink({
          type: "propagation:coalesced",
          absoluteAddress: record.absoluteAddress,
          droppedTransactionId: previous.transactionId,
          winnerTransactionId: record.context.transactionId,
        });
      }
      contextByAbsoluteAddress.set(record.absoluteAddress, record.context);
    }
    const processBindings: IBindingInfo[] = [];
    const propagationContextByBinding = new Map<IBindingInfo, IPropagationContext | null>();
    for (const [absoluteAddress, context] of contextByAbsoluteAddress) {
      if (context !== null && context.hop >= MAX_PROPAGATION_HOPS) {
        // hop 上限超過: この transaction の未処理 record だけを quarantine する。
        // 既に適用した値は戻さず、updater から例外は投げない（設計書 §4 規則 6）。
        console.error(`[@wcstack/state] propagation hop limit exceeded; update record quarantined.`, {
          path: absoluteAddress.absolutePathInfo.pathInfo.path,
          stateName: absoluteAddress.absolutePathInfo.stateName,
          transactionId: context.transactionId,
          hop: context.hop,
          maxHops: MAX_PROPAGATION_HOPS,
        });
        if (devtoolsSink !== null) {
          devtoolsSink({
            type: "propagation:hop-limit",
            absoluteAddress,
            transactionId: context.transactionId,
            hop: context.hop,
          });
        }
        continue;
      }
      // peek: バインディングの無いアドレス（リスト置換で enqueue される中間
      // アドレス等）に空エントリを生成・蓄積しない。エントリは単一 binding
      // （通常ケース）か Set（同一アドレスに 2 本以上）のどちらか。
      // 従来台帳 → パターン台帳（リスト行）の順で引く。
      const entry = peekBindingsForAddress(absoluteAddress);
      if (entry === undefined) {
        continue;
      }
      if (entry instanceof Set) {
        for(const binding of entry) {
          if (binding.replaceNode.isConnected === false) {
            // 切断されているバインディングは無視
            continue;
          }
          processBindings.push(binding);
          if (context !== null) {
            propagationContextByBinding.set(binding, context);
          }
        }
      } else if (entry.replaceNode.isConnected !== false) {
        processBindings.push(entry);
        if (context !== null) {
          propagationContextByBinding.set(entry, context);
        }
      }
    }
    // drain 終了フック: binding 適用後に dedup 済みバッチを通知する（設計書 §3-2）。
    // testApplyChange も同じ _applyChange を通るため、テストから同期に駆動できる。
    // quarantine された address も state 値は適用済みのため通知対象に含める。
    //
    // try/finally なのは、適用側が throw しても `$watch` / `$streams` restart を
    // 落とさないため。binding 1 本の失敗は applyChangeFromBindings が隔離するので
    // ここへ来るのは $updatedCallback の throw（契約どおり loud に伝播させる）等に
    // 限られるが、そのとき drain フックまで道連れにすると「機構間の順序は固定」
    // （README の 3 層表）が黙って破れる。例外は握らない ＝ 伝播は維持する。
    try {
      const applyBindings = (): void => {
        // context が無い場合は従来どおり 1 引数で呼ぶ（呼び出し契約の互換維持）
        if (propagationContextByBinding.size > 0) {
          applyChangeFromBindings(processBindings, propagationContextByBinding);
        } else {
          applyChangeFromBindings(processBindings);
        }
      };
      // View transition 参加点（docs/view-transition-design.md §7.2）。arbiter が
      // 居なければ runTransition はその場で applyBindings を呼び、undefined を返す
      // ＝ 従来と完全に同じ同期適用。SSR では遷移そのものを持たない（G5）。
      //
      // 適用する binding が 0 本のバッチは arbiter へ渡さない。書き込みはバインドの
      // 有無に関わらず enqueue される（setByAddress）ため、headless なパス
      // （`$watch` 専用・`$streams` の内部状態・リスト置換の中間アドレス）への
      // 書き込みだけでもここへ到達する。それでページ全体をスナップショットするのは
      // 無駄なだけでなく、既定の mode="latest" では「アニメーションすべき DOM 変更が
      // 無い遷移」が実行中の本物の遷移をスキップしてしまう（ルート遷移が毎回途中で
      // 切れる／active が空撃ちで振動する）。
      if (inSsr() || processBindings.length === 0) {
        applyBindings();
      } else {
        const pending = runTransition("state", applyBindings);
        if (pending !== undefined) {
          pending.catch(reportDeferredApplyFailure);
        }
      }
    } finally {
      notifyUpdateBatchListeners(new Set(contextByAbsoluteAddress.keys()));
    }
  }

}

const updater = new Updater();

export function getUpdater(): Updater {
  return updater;
}

// テスト用にprivateメソッドを公開
export const __private__ = {
  Updater,
  reportDeferredApplyFailure,
};
