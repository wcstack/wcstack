import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { getBindingSetByAbsoluteStateAddress } from "../binding/getBindingSetByAbsoluteStateAddress";
class Updater {
    _queueAbsoluteAddresses = [];
    constructor() {
    }
    enqueueAbsoluteAddress(absoluteAddress) {
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
    testApplyChange(absoluteAddresses) {
        this._applyChange(absoluteAddresses);
    }
    _applyChange(absoluteAddresses) {
        // Note: AbsoluteStateAddress はキャッシュされているため、
        // 同一の (stateName, address) は同じインスタンスとなり、
        // Set による重複排除が正しく機能する    
        const absoluteAddressSet = new Set(absoluteAddresses);
        const processBindingInfos = [];
        for (const absoluteAddress of absoluteAddressSet) {
            const bindings = getBindingSetByAbsoluteStateAddress(absoluteAddress);
            for (const binding of bindings) {
                if (binding.replaceNode.isConnected === false) {
                    // 切断されているバインディングは無視
                    continue;
                }
                processBindingInfos.push(binding);
            }
        }
        applyChangeFromBindings(processBindingInfos);
    }
}
const updater = new Updater();
export function getUpdater() {
    return updater;
}
// テスト用にprivateメソッドを公開
export const __private__ = {
    Updater,
};
//# sourceMappingURL=updater.js.map