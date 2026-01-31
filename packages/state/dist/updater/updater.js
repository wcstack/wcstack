import { applyChange } from "../apply/applyChange";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
class Updater {
    _stateName;
    _versionInfo;
    _updateAddresses = [];
    _state;
    _applyPromise = null;
    _applyResolve = null;
    _stateElement;
    constructor(stateName, state, version) {
        this._versionInfo = {
            version: version,
            revision: 0,
        };
        this._stateName = stateName;
        this._state = state;
        this._stateElement = getStateElementByName(this._stateName) ?? raiseError(`Updater: State element with name "${this._stateName}" not found.`);
    }
    get versionInfo() {
        return this._versionInfo;
    }
    enqueueUpdateAddress(address) {
        const stateElement = this._stateElement;
        this._updateAddresses.push(address);
        this._versionInfo.revision++;
        stateElement.mightChangeByPath.set(address.pathInfo.path, {
            version: this._versionInfo.version,
            revision: this._versionInfo.revision,
        });
        if (this._applyPromise !== null) {
            return;
        }
        this._applyPromise = new Promise((resolve) => {
            this._applyResolve = resolve;
        });
        queueMicrotask(() => {
            this._processUpdates();
        });
    }
    _processUpdates() {
        const stateElement = this._stateElement;
        const addressSet = new Set(this._updateAddresses);
        this._updateAddresses.length = 0;
        const applyList = [];
        for (const address of addressSet) {
            const value = this._state.$$getByAddress(address);
            const bindingInfos = stateElement.bindingInfosByAddress.get(address);
            if (typeof bindingInfos === "undefined") {
                continue;
            }
            for (const bindingInfo of bindingInfos) {
                applyList.push({
                    bindingInfo,
                    value,
                });
            }
        }
        for (const applyInfo of applyList) {
            const { bindingInfo, value } = applyInfo;
            applyChange(bindingInfo, value);
        }
        if (this._applyResolve !== null) {
            this._applyResolve();
            this._applyResolve = null;
            this._applyPromise = null;
        }
    }
}
export function createUpdater(stateName, state, version) {
    return new Updater(stateName, state, version);
}
//# sourceMappingURL=updater.js.map