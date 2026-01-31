import { IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { IUpdater } from "../updater/types";
import { IStateHandler, IStateProxy } from "./types";
import { get as trapGet } from "./traps/get";
import { set as trapSet } from "./traps/set";
import { ILoopContext } from "../list/types";
import { IState } from "../types";
import { createUpdater } from "../updater/updater";

class StateHandler implements IStateHandler {
  private _stateElement: IStateElement;
  private _stateName: string;
  private _addressStack: (IStateAddress | null)[] = [];
  private _addressStackIndex: number = -1;

  private _updater: IUpdater | undefined;

  private _loopContext: ILoopContext | null | undefined;

  constructor(
    stateName: string
  ) {
    this._stateName = stateName;
    const stateElement = getStateElementByName(this._stateName);
    if (stateElement === null) {
      raiseError(`StateHandler: State element with name "${this._stateName}" not found.`);
    }
    this._stateElement = stateElement;
  }

  get stateName(): string {
    return this._stateName;
  }

  get stateElement(): IStateElement {
    return this._stateElement;
  }

  get lastAddressStack(): IStateAddress | null {
    if (this._addressStackIndex >= 0) {
      return this._addressStack[this._addressStackIndex];
    } else {
      return null;
    }
  }

  get addressStack(): (IStateAddress | null)[] {
    return this._addressStack;
  }

  get addressStackIndex(): number {
    return this._addressStackIndex;
  }

  get updater(): IUpdater {
    if (typeof this._updater === "undefined") {
      raiseError(`StateHandler: updater is not set yet.`);
    }
    return this._updater;
  }
  set updater(value: IUpdater) {
    this._updater = value;
  }

  get loopContext(): ILoopContext | null | undefined {
    return this._loopContext;
  }

  pushAddress(address: IStateAddress | null): void {
    this._addressStackIndex++;
    if (this._addressStackIndex >= this._addressStack.length) {
      this._addressStack.push(address);
    } else {
      this._addressStack[this._addressStackIndex] = address;
    }
  }

  popAddress(): IStateAddress | null {
    if (this._addressStackIndex < 0) {
      return null;
    }
    const address = this._addressStack[this._addressStackIndex];
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
    target  : Object, 
    prop    : PropertyKey, 
    receiver: any
  ): any {
    return trapGet(target, prop, receiver, this);
  }

  set(
    target  : Object, 
    prop    : PropertyKey, 
    value   : any, 
    receiver: any
  ): boolean {
    return trapSet(target, prop, value, receiver, this);
  }

  has(
    target: Object, 
    prop  : PropertyKey
  ): boolean {
    return Reflect.has(target, prop);
//    return Reflect.has(target, prop) || this.symbols.has(prop) || this.apis.has(prop);
  }

}

export function createStateProxy(
  state: IState,
  stateName: string
): IStateProxy {
  const handler = new StateHandler(stateName);
  const stateProxy = new Proxy<IStateProxy>(state as IStateProxy, handler);
  handler.updater = createUpdater(stateName, stateProxy, handler.stateElement.nextVersion());
  return stateProxy;
}