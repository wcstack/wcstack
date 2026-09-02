import { IStateAddress } from "../address/types";
import { IStateElement } from "../components/types";
import { raiseError } from "../raiseError";
import { getStateElement } from "../stateElementByName";
import { IStateHandler, IStateProxy, Mutability } from "./types";
import { get as trapGet } from "./traps/get";
import { set as trapSet } from "./traps/set";
import { ILoopContext } from "../list/types";
import { IState } from "../types";
import { MAX_LOOP_DEPTH } from "../define";

/** 循環報告に載せるスタック末尾の段数（当事者が見える最小限） */
const CYCLE_REPORT_DEPTH = 8;

class StateHandler implements IStateHandler {
  private _stateElement: IStateElement;
  private _stateName: string;
  private _addressStack: (IStateAddress | null | undefined)[] = Array(MAX_LOOP_DEPTH).fill(undefined);
  private _addressStackIndex: number = -1;
  private _loopContext: ILoopContext | null | undefined;
  private _mutability: Mutability;
  private _untrackDepth: number = 0;
 
  constructor(
    rootNode: Node,
    stateName: string,
    mutability: Mutability
  ) {
    this._stateName = stateName;
    const stateElement = getStateElement(rootNode);
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
    // 上限判定は **increment より前**に行う。後にすると、深さ超過で throw した時点で
    // `_addressStackIndex` だけが進み `_addressStack[index]` は未代入のまま残る。
    // 呼び出し側（getByAddress）は `pushAddress` を try の外で呼ぶので自分では pop
    // しないが、外側フレームの finally が順に pop していき、その 1 本目が未代入の枠を
    // 引いて `Address stack at index N is undefined.` を投げる ＝ **本来の
    // 「無限ループの疑い」という診断が巻き戻しの最中に上書きされて消える**。
    // getter の相互参照（`get a(){return this.b}` / `get b(){return this.a}`）は
    // 実際にこれを踏み、原因と無関係な文面だけが残っていた。
    if (this._addressStackIndex + 1 >= MAX_LOOP_DEPTH) {
      raiseError(
        `Exceeded maximum address stack depth of ${MAX_LOOP_DEPTH}. ` +
        `Possible circular dependency between path getters: ${this._describeAddressCycle()}`,
      );
    }
    this._addressStackIndex++;
    this._addressStack[this._addressStackIndex] = address;
  }

  /**
   * スタック末尾の繰り返し区間をパス名で示す（循環の当事者だけを見せる）。
   * 上限に達したときのみ呼ばれるので、コストは異常系に閉じている。
   */
  private _describeAddressCycle(): string {
    const paths: string[] = [];
    for (let i = this._addressStackIndex; i >= 0 && paths.length < CYCLE_REPORT_DEPTH; i--) {
      const entry = this._addressStack[i];
      if (entry) {
        paths.push(entry.pathInfo.path);
      }
    }
    const unique = Array.from(new Set(paths));
    return `${unique.reverse().join(" -> ")} -> ...`;
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

  get untracking(): boolean {
    return this._untrackDepth > 0;
  }

  beginUntrack(): void {
    this._untrackDepth++;
  }

  endUntrack(): void {
    this._untrackDepth--;
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
  rootNode: Node,
  state: IState,
  stateName: string,
  mutability: Mutability
): IStateProxy {
  const handler = new StateHandler(rootNode, stateName, mutability);
  const stateProxy = new Proxy<IStateProxy>(state as IStateProxy, handler);
  return stateProxy;
}

export const __private__ = {
  StateHandler,
};