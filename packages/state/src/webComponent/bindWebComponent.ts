import { getBindingsByNode } from "../bindings/getBindingsByNode";
import { IStateElement } from "../components/types";
import { config } from "../config";
import { WEBCOMPONENT_STATE_READY_CALLBACK_NAME } from "../define";
import { raiseError } from "../raiseError";
import { markWebComponentAsComplete } from "./completeWebComponent";
import { createInnerState } from "./innerState";
import { buildPrimaryMappingRule } from "./MappingRule";
import { meltFrozenObject } from "./meltFrozenObject";
import { createOuterState } from "./outerState";
import { warnOwnKeyShadows } from "./ownKeyShadow";
import { setStateElementByWebComponent } from "./stateElementByWebComponent";
import { IOuterState } from "./types";

const getOuter = (outerState: IOuterState) => (): IOuterState => outerState;

export function bindWebComponent(
  innerStateElement: IStateElement,
  component: Element,
  stateProp: string,
  state: Record<string, any>
): void {
  setStateElementByWebComponent(component, stateProp, innerStateElement);
  // 分岐は「data-wcs 属性の有無」ではなく「<stateProp>.* バインドが 1 件以上あるか」で決める。
  // 属性はあってもマッピング対象が 0 件（例: data-wcs="class.on: flag" だけ）の場合、
  // buildPrimaryMappingRule は primaryMappingRule を 1 件も作らないまま return するため、
  // outerState の lastValue / $postUpdate 意味論だけが残る。その状態では
  // component[stateProp] の read が常に undefined・write が完全な no-op になる
  // （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.2）。
  const bindings = component.hasAttribute(config.bindAttributeName)
    ? (getBindingsByNode(component) ?? []).filter(
        binding => binding.propSegments[0] === stateProp
      )
    : [];
  // 分岐が決めるのは「子の state の中身」だけ。mapped なら親 state へ解決する
  // innerState proxy、plain なら melt 済みのローカル state。
  if (bindings.length > 0) {
    buildPrimaryMappingRule(component, stateProp, bindings);
    // own data key とマウントの衝突を 1 回だけ報告する（R1 の私有キーがツリーを隠す形と、
    // 部分マウントで v2 に反転する形 — docs/state-mount-design.md D19）。
    warnOwnKeyShadows(component, stateProp, state);
    // 値の正本が親スコープにあることを state 要素に記録する。越境アドレスの受け渡しと
    // リストパスの外向き伝播はこのフラグでのみ有効になる（§1.8）。
    innerStateElement.markComponentStateMapped?.();
    innerStateElement.setInitialState(createInnerState(component, stateProp));
  } else {
    innerStateElement.setInitialState(meltFrozenObject(state));
  }
  // 外向きに露出する proxy は両者で同一。mapped でも read はライブ・write は
  // innerState 経由で親 state に届く（§1.1 / G1）。
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
