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
  private _addressStack: (IStateAddress | null | undefined)[] = Array(MAX_LOOP_DEPTH).fill(undefined);
  private _addressStackIndex: number = -1;
  private _loopContext: ILoopContext | null | undefined;
  private _mutability: Mutability;
  private _untrackDepth: number = 0;
 
  constructor(
    rootNode: Node,
    mutability: Mutability
  ) {
    const stateElement = getStateElement(rootNode);
    if (stateElement === null) {
      raiseError(`StateHandler: no state tree found on this root.`);
    }
    this._stateElement = stateElement;
    this._mutability = mutability;
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

  addressStackAt(position: number): IStateAddress | null {
    // 範囲外は配列読みが undefined を返すので、そのまま null に畳む。
    return this._addressStack[position] ?? null;
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
      // 深さ超過と循環は別の原因で、助言も違う。末尾に同じパスが再登場していれば
      // getter どうしが呼び合っている（循環）、全部別パスなら単に深すぎる（正当に
      // 深いツリーの集計など）。両方を「循環の可能性」と告発していたため、循環の無い
      // 直線の木でも「相互参照を直せ」と読める文面が出ていた
      // （docs/state-recursive-path-impl-plan.md §3-2 の E2）。
      if (this._hasRepeatedAddress()) {
        raiseError(
          `[wcs/getter-cycle] Exceeded maximum address stack depth of ${MAX_LOOP_DEPTH}. ` +
          `Possible circular dependency between path getters: ${this._describeAddressCycle()}`,
        );
      }
      raiseError(
        `[wcs/getter-depth-exceeded] Exceeded maximum address stack depth of ${MAX_LOOP_DEPTH} ` +
        `with no address visited twice — the data is simply nested deeper than the engine evaluates ` +
        `in one pass. Deepest path first: ${this._describeAddressCycle()}`,
      );
    }
    this._addressStackIndex++;
    this._addressStack[this._addressStackIndex] = address;
  }

  /**
   * スタック末尾の繰り返し区間をパス名で示す（循環の当事者だけを見せる）。
   * 上限に達したときのみ呼ばれるので、コストは異常系に閉じている。
   */
  /**
   * スタック全体（最大 MAX_LOOP_DEPTH 段）に**同じアドレスが再登場する**か。
   *
   * 循環と深さ超過を分ける述語。パス文字列ではなくアドレスの同一性で見るのは、
   * どちらの側にも文字列では判別できない形があるため:
   * - 末尾 N 段のパス重複だけを見ると、周期が N より長い getter の輪を取り逃がす
   *   （そして「重複が無い＝ただ深いだけ」と**積極的に誤った断定**をしてしまう）
   * - 逆に「同じパスを別の行で読む」正当な再帰（隣接項目参照・累積 getter）は
   *   パス文字列が全段同じなので、文字列で見ると循環に誤告発される
   *
   * IStateAddress は (pathInfo, listIndex) で intern されているので、真の輪だけが
   * 同じインスタンスに戻る。コストは異常系に閉じた O(MAX_LOOP_DEPTH) の Set 構築 1 回。
   */
  private _hasRepeatedAddress(): boolean {
    const seen: Set<IStateAddress> = new Set();
    for (let i = 0; i <= this._addressStackIndex; i++) {
      const entry = this._addressStack[i];
      if (!entry) {
        continue;
      }
      if (seen.has(entry)) {
        return true;
      }
      seen.add(entry);
    }
    return false;
  }

  /** スタック末尾の CYCLE_REPORT_DEPTH 段のパス（深い順）。診断の表示に使う。 */
  private _tailAddressPaths(): string[] {
    const paths: string[] = [];
    for (let i = this._addressStackIndex; i >= 0 && paths.length < CYCLE_REPORT_DEPTH; i--) {
      const entry = this._addressStack[i];
      if (entry) {
        paths.push(entry.pathInfo.path);
      }
    }
    return paths;
  }

  private _describeAddressCycle(): string {
    const paths: string[] = this._tailAddressPaths();
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
      raiseError(`This state is readonly.`);
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
  mutability: Mutability
): IStateProxy {
  const handler = new StateHandler(rootNode, mutability);
  const stateProxy = new Proxy<IStateProxy>(state as IStateProxy, handler);
  return stateProxy;
}

export const __private__ = {
  StateHandler,
};