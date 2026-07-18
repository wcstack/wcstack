import { IAbsoluteStateAddress, IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { ILoopContext } from "../list/types";
import { IState } from "../types";
import { connectedCallbackSymbol, disconnectedCallbackSymbol, getByAddressSymbol, hasByAddressSymbol, setByAddressSymbol, setLoopContextAsyncSymbol, setLoopContextSymbol, updatedCallbackSymbol } from "./symbols";

export interface IStateHandler extends ProxyHandler<IState> {
  readonly stateName: string;
  readonly stateElement: IStateElement;
  readonly addressStackLength: number;
  readonly lastAddressStack: IStateAddress | null;
  readonly loopContext: ILoopContext | null | undefined;
  /**
   * 依存追跡の抑止中か。$untrackDependency のスコープ内、および setter 実行中
   * （setter は命令的な代入であって派生ではないため、その中の読み取りで依存を
   * 張らない）は true。checkDependency / $1 インデックス依存の登録が抑止される。
   */
  readonly untracking: boolean;

  pushAddress(address: IStateAddress | null): void;
  popAddress(): IStateAddress | null;
  setLoopContext(loopContext: ILoopContext | null): void;
  clearLoopContext(): void;
  beginUntrack(): void;
  endUntrack(): void;
}

export interface IStateProxy extends IState {
  [setLoopContextAsyncSymbol](loopContext: ILoopContext | null, callback: () => Promise<any>): Promise<any>;
  [setLoopContextSymbol](loopContext: ILoopContext | null, callback: () => any): any;
  [getByAddressSymbol](address: IStateAddress): any;
  [hasByAddressSymbol](address: IStateAddress): boolean;
  [setByAddressSymbol](address: IStateAddress, value: any): void;
  [connectedCallbackSymbol](): Promise<void>;
  [disconnectedCallbackSymbol](): void;
  [updatedCallbackSymbol](updatedAbsAddressList: IAbsoluteStateAddress[]): void;
}

export type Mutability = "readonly" | "writable";
