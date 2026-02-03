import { applyChangeFromBindings } from "../apply/applyChangeFromBindings";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
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
            const stateElement = getStateElementByName(absoluteAddress.stateName);
            if (stateElement === null) {
                raiseError(`State element with name "${absoluteAddress.stateName}" not found for updater.`);
            }
            const bindingInfos = stateElement.bindingInfosByAddress.get(absoluteAddress.address);
            if (typeof bindingInfos !== "undefined") {
                processBindingInfos.push(...bindingInfos);
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