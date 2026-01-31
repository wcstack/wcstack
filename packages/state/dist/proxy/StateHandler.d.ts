import { IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { IUpdater } from "../updater/types";
import { IStateHandler, IStateProxy } from "./types";
import { ILoopContext } from "../list/types";
import { IState } from "../types";
declare class StateHandler implements IStateHandler {
    private _stateElement;
    private _stateName;
    private _addressStack;
    private _addressStackIndex;
    private _updater;
    private _loopContext;
    constructor(stateName: string);
    get stateName(): string;
    get stateElement(): IStateElement;
    get lastAddressStack(): IStateAddress | null;
    get addressStack(): (IStateAddress | null)[];
    get addressStackIndex(): number;
    get updater(): IUpdater;
    set updater(value: IUpdater);
    get loopContext(): ILoopContext | null | undefined;
    pushAddress(address: IStateAddress | null): void;
    popAddress(): IStateAddress | null;
    setLoopContext(loopContext: ILoopContext | null): void;
    clearLoopContext(): void;
    get(target: Object, prop: PropertyKey, receiver: any): any;
    set(target: Object, prop: PropertyKey, value: any, receiver: any): boolean;
    has(target: Object, prop: PropertyKey): boolean;
}
export declare function createStateProxy(state: IState, stateName: string): IStateProxy;
export declare const __private__: {
    StateHandler: typeof StateHandler;
};
export {};
//# sourceMappingURL=StateHandler.d.ts.map