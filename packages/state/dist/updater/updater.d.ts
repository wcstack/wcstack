import { IStateAddress } from "../address/types";
import { IStateProxy } from "../proxy/types";
import { IVersionInfo } from "../version/types";
declare class Updater {
    private _stateName;
    private _versionInfo;
    private _updateAddresses;
    private _state;
    private _applyPromise;
    private _applyResolve;
    private _stateElement;
    constructor(stateName: string, state: IStateProxy, version: number);
    get versionInfo(): IVersionInfo;
    enqueueUpdateAddress(address: IStateAddress): void;
    private _processUpdates;
}
export declare function createUpdater(stateName: string, state: IStateProxy, version: number): Updater;
export {};
//# sourceMappingURL=updater.d.ts.map