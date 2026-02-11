import { IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { ILoopContext } from "../list/types";
import { IState } from "../types";
import { connectedCallbackSymbol, disconnectedCallbackSymbol, getByAddressSymbol, setLoopContextAsyncSymbol, setLoopContextSymbol } from "./symbols";

export interface IStateHandler extends ProxyHandler<IState> {
  readonly stateName: string;
  readonly stateElement: IStateElement;
  readonly addressStackLength: number;
  readonly lastAddressStack: IStateAddress | null;
  readonly loopContext: ILoopContext | null | undefined;

  pushAddress(address: IStateAddress | null): void;
  popAddress(): IStateAddress | null;
  setLoopContext(loopContext: ILoopContext | null): void;
  clearLoopContext(): void;
}

export interface IStateProxy extends IState {
  [setLoopContextAsyncSymbol](loopContext: ILoopContext | null, callback: () => Promise<any>): Promise<any>;
  [setLoopContextSymbol](loopContext: ILoopContext | null, callback: () => any): any;
  [getByAddressSymbol](address: IStateAddress): any;
  [connectedCallbackSymbol](): Promise<void>;
  [disconnectedCallbackSymbol](): void;
}

export type Mutability = "readonly" | "writable";
