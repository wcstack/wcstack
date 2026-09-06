import { IStateElement } from "../components/types";
import { WEBCOMPONENT_STATE_READY_CALLBACK_NAME } from "../define";
import { raiseError } from "../raiseError";
import { markWebComponentAsComplete } from "./completeWebComponent";
import { meltFrozenObject } from "./meltFrozenObject";
import { createOuterState } from "./outerState";
import { setStateElementByWebComponent } from "./stateElementByWebComponent";
import { IOuterState } from "./types";

const getOuter = (outerState: IOuterState) => (): IOuterState => outerState;

export function bindWebComponent(
  innerStateElement: IStateElement,
  component: Element,
  stateProp: string,
  state: Record<string, any>
): void {
  // v2: ホスト配線（`state[.sub]: path`）のある形は全てマウント（State.ts の v2 経路）に
  // 乗るため、ここへ来るのは **plain**（配線なしの state 注入）だけ。melt した作者の
  // オブジェクトをそのまま自分の state 要素の実体にする。
  setStateElementByWebComponent(component, stateProp, innerStateElement);
  innerStateElement.setInitialState(meltFrozenObject(state));
  // 公開プロパティは outerState proxy（read はライブ・write は自分の state 要素へ）
  const outerState = createOuterState(component, stateProp);
  Object.defineProperty(component, stateProp, {
    get: getOuter(outerState),
    enumerable: true,
    configurable: true,
  });
  markWebComponentAsComplete(component, stateProp);
  invokeStateReadyCallback(component, stateProp);
}

/** `$stateReadyCallback` の呼び出し（v1 の bindWebComponent と v2 のマウント経路で共用）。 */
export function invokeStateReadyCallback(component: Element, stateProp: string): void {
  if (WEBCOMPONENT_STATE_READY_CALLBACK_NAME in component) {
    const func = (component as any)[WEBCOMPONENT_STATE_READY_CALLBACK_NAME];
    if (typeof func === 'function') {
      func.call(component, stateProp).catch((error: any) => {
        raiseError(`Error in ${WEBCOMPONENT_STATE_READY_CALLBACK_NAME}: ${error instanceof Error ? error.message : String(error)}`);
      });
    } else {
      raiseError(`${WEBCOMPONENT_STATE_READY_CALLBACK_NAME} is not a function.`);
    }
  }
}
