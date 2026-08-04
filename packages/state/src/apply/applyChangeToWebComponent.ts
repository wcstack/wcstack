import { DELIMITER } from "../define";
import { raiseError } from "../raiseError";
import { IBindingInfo } from "../types";
import { getStateElementByWebComponent } from "../webComponent/stateElementByWebComponent";
import { IApplyContext } from "./types";

/**
 * 親 state → `bind-component` 済みコンポーネントの再読込通知（内部チャネル）。
 *
 * 値そのものは運ばない。バインドされたパスの正本は親 state 側にあり、子は
 * innerState proxy のマッピング経由で親を読みに行くため、必要なのは
 * 「そのパスを読み直せ」という通知だけ。
 *
 * 以前は `element[stateProp][path] = value` と、コンポーネントの公開プロパティを
 * 経由してこの通知を送っていた。受け側の proxy が値を捨てて `$postUpdate` を呼ぶ
 * 作りだったのはそのためだが、同じ proxy が `this.state` として作者にも見えていたので、
 * 公開 API 側の書き込みまで no-op になっていた。通知はここで state element を直接
 * 引く形に分離し、公開 proxy は素通し意味論に統一した
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.1 / G1）。
 *
 * この関数が選ばれるのは `isWebComponentComplete` が真のときだけなので
 * （apply/applyChange.ts）、`bindWebComponent` は完了済み ＝ state element は登録済み。
 */
export function applyChangeToWebComponent(binding: IBindingInfo, _context: IApplyContext, _newValue: unknown): void {
  const element = binding.node as Element;
  const propSegments = binding.propSegments;
  if (propSegments.length <= 1) {
    raiseError(`Invalid propSegments for web component binding: ${propSegments.join(DELIMITER)}`);
  }
  const [ firstSegment, ...restSegments ] = propSegments;
  const innerStateElement = getStateElementByWebComponent(element, firstSegment);
  if (innerStateElement === null) {
    raiseError(`State element not bound to "${firstSegment}" on web component.`);
  }
  innerStateElement.createState("readonly", (state) => {
    state.$postUpdate(restSegments.join(DELIMITER));
  });
}
