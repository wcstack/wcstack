import { IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { ILoopContext } from "../list/types";
import { IState } from "../types";
export interface IStateHandler extends ProxyHandler<IState> {
    readonly stateName: string;
    readonly stateElement: IStateElement;
    readonly addressStack: (IStateAddress | null)[];
    readonly addressStackIndex: number;
    readonly lastAddressStack: IStateAddress | null;
    readonly loopContext: ILoopContext | null | undefined;
    pushAddress(address: IStateAddress | null): void;
    popAddress(): IStateAddress | null;
    setLoopContext(loopContext: ILoopContext | null): void;
    clearLoopContext(): void;
}
export interface IStateProxy extends IState {
    $$setLoopContextAsync(loopContext: ILoopContext | null, callback: () => Promise<any>): Promise<any>;
    $$setLoopContext(loopContext: ILoopContext | null, callback: () => any): any;
    $$getByAddress(address: IStateAddress): any;
}
export type Mutability = "readonly" | "writable";
//# sourceMappingURL=types.d.ts.map