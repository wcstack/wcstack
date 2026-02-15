import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { getPathInfo } from "../address/PathInfo";
import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { addBindingByNode, getBindingsByNode } from "../bindings/getBindingsByNode";
import { DELIMITER } from "../define";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";
const innerMappingByElement = new WeakMap();
const outerMappingByElement = new WeakMap();
const primaryMappingRuleSetByElement = new WeakMap();
const primaryBindingByMappingRule = new WeakMap();
function createMappingRuleByBinding(innerState, binding) {
    const innerPathInfo = getPathInfo(binding.propSegments.slice(1).join(DELIMITER));
    const innerAbsPathInfo = getAbsolutePathInfo(innerState, innerPathInfo);
    const outerAbsStateAddress = getAbsoluteStateAddressByBinding(binding);
    const outerAbsPathInfo = outerAbsStateAddress.absolutePathInfo;
    return { innerAbsPathInfo, outerAbsPathInfo };
}
export function buildPrimaryMappingRule(webComponent) {
    const bindings = getBindingsByNode(webComponent);
    if (bindings === null) {
        raiseError('WebComponent node must have at least one binding.');
    }
    const innerState = getStateElementByWebComponent(webComponent);
    if (innerState === null) {
        raiseError('State element not found for web component.');
    }
    const innerMappingRule = new Map();
    const outerMappingRule = new Map();
    for (const binding of bindings) {
        const mappingRule = createMappingRuleByBinding(innerState, binding);
        let primaryMappingRuleSet = primaryMappingRuleSetByElement.get(webComponent);
        if (typeof primaryMappingRuleSet === 'undefined') {
            primaryMappingRuleSetByElement.set(webComponent, new Set([mappingRule]));
        }
        else {
            primaryMappingRuleSet.add(mappingRule);
        }
        const innerAbsPathInfo = mappingRule.innerAbsPathInfo;
        const outerAbsPathInfo = mappingRule.outerAbsPathInfo;
        primaryBindingByMappingRule.set(mappingRule, binding);
        innerMappingRule.set(innerAbsPathInfo, outerAbsPathInfo);
        outerMappingRule.set(outerAbsPathInfo, innerAbsPathInfo);
    }
    innerMappingByElement.set(webComponent, innerMappingRule);
    outerMappingByElement.set(webComponent, outerMappingRule);
}
export function getInnerAbsolutePathInfo(webComponent, outerAbsPathInfo) {
    const mapping = outerMappingByElement.get(webComponent);
    if (typeof mapping === 'undefined') {
        return null;
    }
    return mapping.get(outerAbsPathInfo) ?? null;
}
export function getOuterAbsolutePathInfo(webComponent, innerAbsPathInfo) {
    let innerMapping = innerMappingByElement.get(webComponent);
    if (typeof innerMapping === 'undefined') {
        innerMapping = new Map();
        innerMappingByElement.set(webComponent, innerMapping);
    }
    if (innerMapping.has(innerAbsPathInfo)) {
        return innerMapping.get(innerAbsPathInfo);
    }
    let outerMapping = outerMappingByElement.get(webComponent);
    if (typeof outerMapping === 'undefined') {
        outerMapping = new Map();
        outerMappingByElement.set(webComponent, outerMapping);
    }
    // 内側からのアクセスの場合、ルールがなければプライマリルールから新たにルールとバインディングを生成する
    const primaryMappingRuleSet = primaryMappingRuleSetByElement.get(webComponent);
    if (typeof primaryMappingRuleSet === 'undefined') {
        raiseError('Primary mapping rule set not found for web component.');
    }
    let primaryMappingRule = null;
    for (const currentPrimaryMappingRule of primaryMappingRuleSet) {
        // innerPathInfoがprimaryMappingRuleのinnerPathInfoを包含しているか
        if (!innerAbsPathInfo.pathInfo.cumulativePathInfoSet.has(currentPrimaryMappingRule.innerAbsPathInfo.pathInfo)) {
            continue;
        }
        if (currentPrimaryMappingRule.innerAbsPathInfo.pathInfo.segments.length === innerAbsPathInfo.pathInfo.segments.length) {
            raiseError('Duplicate mapping rule for web component.');
        }
        primaryMappingRule = currentPrimaryMappingRule;
        break;
    }
    if (primaryMappingRule === null) {
        raiseError(`Mapping rule not found for inner path "${innerAbsPathInfo.pathInfo.path}". ` +
            `Did you forget to bind this property in the component's data-wcs attribute? ` +
            `Available mappings: ${Array.from(primaryMappingRuleSet).map(r => r.innerAbsPathInfo.pathInfo.path).join(', ')}`);
    }
    // マッチした残りのパスをouterPathInfoに付与して新たなルールを生成
    const primaryBinding = primaryBindingByMappingRule.get(primaryMappingRule);
    /* c8 ignore start */
    if (typeof primaryBinding === 'undefined') {
        raiseError('Binding not found for primary mapping rule on web component.');
    }
    /* c8 ignore stop */
    const outerRemainingSegments = innerAbsPathInfo.pathInfo.segments.slice(primaryMappingRule.innerAbsPathInfo.pathInfo.segments.length);
    const outerSegments = primaryMappingRule.outerAbsPathInfo.pathInfo.segments.concat(outerRemainingSegments);
    const outerPathInfo = getPathInfo(outerSegments.join(DELIMITER));
    const rootNode = webComponent.getRootNode();
    const outerStateElement = getStateElementByName(rootNode, primaryBinding.stateName);
    if (outerStateElement === null) {
        raiseError(`State element with name "${primaryBinding.stateName}" not found for web component.`);
    }
    const outerAbsPathInfo = getAbsolutePathInfo(outerStateElement, outerPathInfo);
    innerMapping.set(innerAbsPathInfo, outerAbsPathInfo);
    outerMapping.set(outerAbsPathInfo, innerAbsPathInfo);
    // ルールに対応するバインディングを生成
    const newBinding = {
        ...primaryBinding,
        propName: innerAbsPathInfo.pathInfo.path,
        propSegments: innerAbsPathInfo.pathInfo.segments,
        statePathName: outerAbsPathInfo.pathInfo.path,
        statePathInfo: outerAbsPathInfo.pathInfo,
    };
    addBindingByNode(webComponent, newBinding);
    return outerAbsPathInfo;
}
//# sourceMappingURL=MappingRule.js.map