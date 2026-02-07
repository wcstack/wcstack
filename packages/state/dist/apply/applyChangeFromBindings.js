import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { applyChange } from "./applyChange";
/**
 * バインディング情報の配列を処理し、各バインディングに対して状態の変更を適用する。
 *
 * 最適化のため、以下のグループ化を行う:
 * 同じ stateName を持つバインディングをグループ化 → createState の呼び出しを削減
 */
export function applyChangeFromBindings(bindingInfos) {
    let bindingInfoIndex = 0;
    const appliedBindingSet = new Set();
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
                state: state,
                appliedBindingSet: appliedBindingSet
            };
            do {
                applyChange(bindingInfo, context);
                bindingInfoIndex++;
                const nextBindingInfo = bindingInfos[bindingInfoIndex];
                if (!nextBindingInfo)
                    break; // 終端に到達
                if (nextBindingInfo.stateName !== stateName)
                    break; // stateName が変わった
                bindingInfo = nextBindingInfo;
            } while (true); // eslint-disable-line no-constant-condition
        });
    }
}
//# sourceMappingURL=applyChangeFromBindings.js.map