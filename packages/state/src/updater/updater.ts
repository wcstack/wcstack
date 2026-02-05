import { IAbsoluteStateAddress } from "../address/types";
import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { getBindingInfosByAbsoluteStateAddress } from "../binding/getBindingInfosByAbsoluteStateAddress";
import { IBindingInfo } from "../types";

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
    const processBindingInfos: IBindingInfo[] = [];
    for (const absoluteAddress of absoluteAddressSet) {
      const bindings = getBindingInfosByAbsoluteStateAddress(absoluteAddress);
      processBindingInfos.push(...bindings);
    }
    applyChangeFromBindings(
      processBindingInfos
    );
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
