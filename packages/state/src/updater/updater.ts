import { IAbsoluteStateAddress } from "../address/types";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { peekBindingSetByAbsoluteStateAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
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

class Updater {
  private _queueAbsoluteAddresses: IAbsoluteStateAddress[] = [];
  constructor() {
  }

  enqueueAbsoluteAddress(absoluteAddress: IAbsoluteStateAddress): void {
    const requireStartProcess = this._queueAbsoluteAddresses.length === 0;
    this._queueAbsoluteAddresses.push(absoluteAddress);
    if (requireStartProcess) {
      queueMicrotask(() => {
        const absoluteAddresses = this._queueAbsoluteAddresses;
        this._queueAbsoluteAddresses = [];
        this._applyChange(absoluteAddresses);
      });
    }
  }

  // テスト用に公開
  testApplyChange(absoluteAddresses: IAbsoluteStateAddress[]): void {
    this._applyChange(absoluteAddresses);
  }

  private _applyChange(absoluteAddresses: IAbsoluteStateAddress[]): void {
    // Note: AbsoluteStateAddress はキャッシュされているため、
    // 同一の (stateName, address) は同じインスタンスとなり、
    // Set による重複排除が正しく機能する    
    const absoluteAddressSet = new Set(absoluteAddresses);
    const processBindings: IBindingInfo[] = [];
    for (const absoluteAddress of absoluteAddressSet) {
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
      }
    }
    applyChangeFromBindings(
      processBindings
    );
    // drain 終了フック: binding 適用後に dedup 済みバッチを通知する（設計書 §3-2）。
    // testApplyChange も同じ _applyChange を通るため、テストから同期に駆動できる。
    notifyUpdateBatchListeners(absoluteAddressSet);
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
