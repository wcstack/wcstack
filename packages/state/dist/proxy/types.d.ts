import { IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { ILoopContext } from "../list/types";
import { IState } from "../types";
import { IUpdater } from "../updater/types";
export interface IStateHandler extends ProxyHandler<IState> {
    readonly stateName: string;
    readonly stateElement: IStateElement;
    updater: IUpdater;
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
    $$setLoopContext(loopContext: ILoopContext | null, callback: () => Promise<void>): Promise<void>;
    $$getByAddress(address: IStateAddress): any;
}
//# sourceMappingURL=types.d.ts.map