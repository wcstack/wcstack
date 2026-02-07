import { IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { IStateHandler, IStateProxy, Mutability } from "./types";
import { ILoopContext } from "../list/types";
import { IState } from "../types";
declare class StateHandler implements IStateHandler {
    private _stateElement;
    private _stateName;
    private _addressStack;
    private _addressStackIndex;
    private _loopContext;
    private _mutability;
    constructor(stateName: string, mutability: Mutability);
    get stateName(): string;
    get stateElement(): IStateElement;
    get lastAddressStack(): IStateAddress | null;
    get addressStack(): (IStateAddress | null)[];
    get addressStackIndex(): number;
    get loopContext(): ILoopContext | null | undefined;
    pushAddress(address: IStateAddress | null): void;
    popAddress(): IStateAddress | null;
    setLoopContext(loopContext: ILoopContext | null): void;
    clearLoopContext(): void;
    get(target: object, prop: PropertyKey, receiver: any): any;
    set(target: object, prop: PropertyKey, value: any, receiver: any): boolean;
    has(target: object, prop: PropertyKey): boolean;
}
export declare function createStateProxy(state: IState, stateName: string, mutability: Mutability): IStateProxy;
export declare const __private__: {
    StateHandler: typeof StateHandler;
};
export {};
//# sourceMappingURL=StateHandler.d.ts.map