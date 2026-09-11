import { IAbsoluteStateAddress, IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { ILoopContext } from "../list/types";
import { IState } from "../types";
import { connectedCallbackSymbol, disconnectedCallbackSymbol, errorCallbackSymbol, getByAddressSymbol, hasByAddressSymbol, setByAddressSymbol, setLoopContextSymbol, updatedCallbackSymbol } from "./symbols";
import type { IBindingErrorInfo } from "../types";

export interface IStateHandler extends ProxyHandler<IState> {
  readonly stateElement: IStateElement;
  readonly addressStackLength: number;
  /**
   * アドレススタックの先頭（いま評価しているアドレス）。ループ文脈の無いスコープでは null。
   * 再帰の深さ解決（recursion/bind.ts）もここだけを見る — 添字の供給元
   * （getContextListIndex / `$getAll` の省略形）が先頭しか見ないので、深さだけを外側の
   * フレームから拾うと「深さはあるが行が無い」定義にない状態になる。
   */
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
  [setLoopContextSymbol](loopContext: ILoopContext | null, callback: () => any): any;
  [getByAddressSymbol](address: IStateAddress): any;
  [hasByAddressSymbol](address: IStateAddress): boolean;
  [setByAddressSymbol](address: IStateAddress, value: any): void;
  [connectedCallbackSymbol](): Promise<void>;
  [disconnectedCallbackSymbol](): void;
  [updatedCallbackSymbol](updatedAbsAddressList: IAbsoluteStateAddress[]): void;
  [errorCallbackSymbol](error: unknown, info: IBindingErrorInfo): void;
}

export type Mutability = "readonly" | "writable";
