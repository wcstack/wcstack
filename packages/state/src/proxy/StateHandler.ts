import { IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IStateHandler, IStateProxy, Mutability } from "./types";
import { get as trapGet } from "./traps/get";
import { set as trapSet } from "./traps/set";
import { ILoopContext } from "../list/types";
import { IState } from "../types";
import { MAX_LOOP_DEPTH } from "../define";

class StateHandler implements IStateHandler {
  private _stateElement: IStateElement;
  private _stateName: string;
  private _addressStack: (IStateAddress | null | undefined)[] = Array(MAX_LOOP_DEPTH).fill(undefined);
  private _addressStackIndex: number = -1;
  private _loopContext: ILoopContext | null | undefined;
  private _mutability: Mutability;
 
  constructor(
    stateName: string,
    mutability: Mutability
  ) {
    this._stateName = stateName;
    const stateElement = getStateElementByName(this._stateName);
    if (stateElement === null) {
      raiseError(`StateHandler: State element with name "${this._stateName}" not found.`);
    }
    this._stateElement = stateElement;
    this._mutability = mutability;
  }

  get stateName(): string {
    return this._stateName;
  }

  get stateElement(): IStateElement {
    return this._stateElement;
  }

  get lastAddressStack(): IStateAddress | null {
    let address: IStateAddress | null | undefined = undefined;
    if (this._addressStackIndex >= 0) {
      address = this._addressStack[this._addressStackIndex];
    }
    if (typeof address === "undefined") {
      raiseError(`Last address stack is undefined.`);
    }
    return address;
  }

  get addressStackLength(): number {
    return this._addressStackIndex + 1;
  }

  get loopContext(): ILoopContext | null | undefined {
    return this._loopContext;
  }

  pushAddress(address: IStateAddress | null): void {
    this._addressStackIndex++;
    if (this._addressStackIndex >= MAX_LOOP_DEPTH) {
      raiseError(`Exceeded maximum address stack depth of ${MAX_LOOP_DEPTH}. Possible infinite loop.`);
    }
    this._addressStack[this._addressStackIndex] = address;
  }

  popAddress(): IStateAddress | null {
    if (this._addressStackIndex < 0) {
      return null;
    }
    const address = this._addressStack[this._addressStackIndex];
    if (typeof address === "undefined") {
      raiseError(`Address stack at index ${this._addressStackIndex} is undefined.`);
    }
    this._addressStack[this._addressStackIndex] = undefined;
    this._addressStackIndex--;
    return address;
  }

  setLoopContext(loopContext: ILoopContext | null): void {
    this._loopContext = loopContext;
  }

  clearLoopContext(): void {
    this._loopContext = undefined;
  }

  get(
    target  : object, 
    prop    : PropertyKey, 
    receiver: any
  ): any {
    return trapGet(target, prop, receiver, this);
  }

  set(
    target  : object, 
    prop    : PropertyKey, 
    value   : any, 
    receiver: any
  ): boolean {
    if (this._mutability === "readonly") {
      raiseError(`State "${this._stateName}" is readonly.`);
    }
    return trapSet(target, prop, value, receiver, this);
  }

  has(
    target: object, 
    prop  : PropertyKey
  ): boolean {
    return Reflect.has(target, prop);
//    return Reflect.has(target, prop) || this.symbols.has(prop) || this.apis.has(prop);
  }

}

export function createStateProxy(
  state: IState,
  stateName: string,
  mutability: Mutability
): IStateProxy {
  const handler = new StateHandler(stateName, mutability);
  const stateProxy = new Proxy<IStateProxy>(state as IStateProxy, handler);
  return stateProxy;
}

export const __private__ = {
  StateHandler,
};