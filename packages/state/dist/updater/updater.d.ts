import { IAbsoluteStateAddress } from "../address/types";
declare class Updater {
    private _queueAbsoluteAddresses;
    constructor();
    enqueueAbsoluteAddress(absoluteAddress: IAbsoluteStateAddress): void;
    testApplyChange(absoluteAddresses: IAbsoluteStateAddress[]): void;
    private _applyChange;
}
export declare function getUpdater(): Updater;
export declare const __private__: {
    Updater: typeof Updater;
};
export {};
//# sourceMappingURL=updater.d.ts.map