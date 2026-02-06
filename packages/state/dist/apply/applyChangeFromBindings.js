import { getLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { applyChange } from "./applyChange";
/**
 * バインディング情報の配列を処理し、各バインディングに対して状態の変更を適用する。
 *
 * 最適化のため、以下の2段階でグループ化を行う:
 * 1. 同じ stateName を持つバインディングをグループ化 → createState の呼び出しを削減
 * 2. 同じ loopContext を持つバインディングをグループ化 → $$setLoopContext の呼び出しを削減
 */
export function applyChangeFromBindings(bindingInfos) {
    let bindingInfoIndex = 0;
    // 外側ループ: stateName ごとにグループ化
    while (bindingInfoIndex < bindingInfos.length) {
        let bindingInfo = bindingInfos[bindingInfoIndex];
        const stateName = bindingInfo.stateName;
        const stateElement = getStateElementByName(stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${stateName}" not found for binding.`);
        }
        stateElement.createState("readonly", (state) => {
            const context = {
                stateName: stateName,
                stateElement: stateElement,
                state: state
            };
            // 中間ループ: 同じ stateName 内で loopContext ごとにグループ化
            do {
                const loopContext = getLoopContextByNode(bindingInfo.node);
                // $$setLoopContext の戻り値:
                //   true  = 同じ stateName だが loopContext が変わった → 中間ループを継続
                //   false = stateName が変わった or 終端に到達 → 中間ループを終了
                const continueWithNewLoopContext = state.$$setLoopContext(loopContext, () => {
                    // 内側ループ: 同じ stateName + loopContext のバインディングを連続処理
                    do {
                        applyChange(bindingInfo, context);
                        bindingInfoIndex++;
                        const nextBindingInfo = bindingInfos[bindingInfoIndex];
                        if (!nextBindingInfo)
                            return false; // 終端に到達
                        if (nextBindingInfo.stateName !== stateName)
                            return false; // stateName が変わった
                        bindingInfo = nextBindingInfo;
                        const nextLoopContext = getLoopContextByNode(nextBindingInfo.node);
                        if (nextLoopContext !== loopContext)
                            return true; // loopContext が変わった
                    } while (true); // eslint-disable-line no-constant-condition
                });
                if (!continueWithNewLoopContext)
                    break;
            } while (true); // eslint-disable-line no-constant-condition
        });
    }
}
//# sourceMappingURL=applyChangeFromBindings.js.map