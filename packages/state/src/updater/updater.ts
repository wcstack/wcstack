import { IAbsoluteStateAddress } from "../address/types";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { peekBindingSetByAbsoluteStateAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
import { MAX_PROPAGATION_HOPS } from "../define";
import { devtoolsSink } from "../devtools/sink";
import { IPropagationContext } from "../propagation/types";
import { IBindingInfo } from "../types";

/**
 * drain（_applyChange）終了通知のリスナー（docs/state-streams-design.md §3-2）。
 * バッチ内の更新アドレス（AbsoluteStateAddress のインスタンス同一性で
 * dedup 済みの Set）を受け取る。stream runtime の依存駆動 restart が
 * この通知を交差判定の入力にする。
 */
export type UpdateBatchListener = (batch: ReadonlySet<IAbsoluteStateAddress>) => void;

const updateBatchListeners: Set<UpdateBatchListener> = new Set();

/**
 * drain 終了リスナーを登録する。
 */
export function registerUpdateBatchListener(listener: UpdateBatchListener): void {
  updateBatchListeners.add(listener);
}

/**
 * drain 終了リスナーを解除する（テスト間の分離用）。
 */
export function unregisterUpdateBatchListener(listener: UpdateBatchListener): void {
  updateBatchListeners.delete(listener);
}

/**
 * 全リスナーに drain のバッチを通知する。
 * リスナーの throw は握りつぶさない（内部バグの隠蔽防止）。
 * stream 側リスナーが entry ごとに自前で try/catch する契約（設計書 §3-2）。
 */
function notifyUpdateBatchListeners(batch: ReadonlySet<IAbsoluteStateAddress>): void {
  for (const listener of updateBatchListeners) {
    listener(batch);
  }
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
      // アドレス等）に空 Set を生成・蓄積しない
      const bindings = peekBindingSetByAbsoluteStateAddress(absoluteAddress);
      if (bindings === undefined) {
        continue;
      }
      for(const binding of bindings) {
        if (binding.replaceNode.isConnected === false) {
          // 切断されているバインディングは無視
          continue;
        }
        processBindings.push(binding);
        if (context !== null) {
          propagationContextByBinding.set(binding, context);
        }
      }
    }
    // context が無い場合は従来どおり 1 引数で呼ぶ（呼び出し契約の互換維持）
    if (propagationContextByBinding.size > 0) {
      applyChangeFromBindings(processBindings, propagationContextByBinding);
    } else {
      applyChangeFromBindings(processBindings);
    }
    // drain 終了フック: binding 適用後に dedup 済みバッチを通知する（設計書 §3-2）。
    // testApplyChange も同じ _applyChange を通るため、テストから同期に駆動できる。
    // quarantine された address も state 値は適用済みのため通知対象に含める。
    notifyUpdateBatchListeners(new Set(contextByAbsoluteAddress.keys()));
  }

}

const updater = new Updater();

export function getUpdater(): Updater {
  return updater;
}

// テスト用にprivateメソッドを公開
export const __private__ = {
  Updater,
};
