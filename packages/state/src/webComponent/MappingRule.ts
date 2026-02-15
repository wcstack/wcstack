import { getAbsolutePathInfo } from "../address/AbsolutePathInfo";
import { getPathInfo } from "../address/PathInfo";
import { IAbsolutePathInfo } from "../address/types";
import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { IBindingInfo } from "../binding/types";
import { addBindingByNode } from "../bindings/getBindingsByNode";
import { IStateElement } from "../components/types";
import { DELIMITER } from "../define";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { getStateElementByWebComponent } from "./stateElementByWebComponent";

export interface IMappingRule {
  innerAbsPathInfo: IAbsolutePathInfo;
  outerAbsPathInfo: IAbsolutePathInfo;
}

const innerMappingByElement: WeakMap<Element, Map<IAbsolutePathInfo, IAbsolutePathInfo>> = new WeakMap();
const outerMappingByElement: WeakMap<Element, Map<IAbsolutePathInfo, IAbsolutePathInfo>> = new WeakMap();
const primaryMappingRuleSetByElement: WeakMap<Element, Set<IMappingRule>> = new WeakMap();
const primaryBindingByMappingRule: WeakMap<IMappingRule, IBindingInfo> = new WeakMap();

function createMappingRuleByBinding(innerState: IStateElement, binding: IBindingInfo): IMappingRule {
  const innerPathInfo = getPathInfo(binding.propSegments.slice(1).join(DELIMITER));
  const innerAbsPathInfo = getAbsolutePathInfo(innerState, innerPathInfo);
  const outerAbsStateAddress = getAbsoluteStateAddressByBinding(binding);
  const outerAbsPathInfo  = outerAbsStateAddress.absolutePathInfo;
  return { innerAbsPathInfo, outerAbsPathInfo };
}

export function buildPrimaryMappingRule(webComponent: Element, stateName: string, bindings: IBindingInfo[]): void {
  if (bindings.length === 0) {
    return;
  }
  const innerState = getStateElementByWebComponent(webComponent, stateName);
  if (innerState === null) {
    raiseError('State element not found for web component.');
  }
  const innerMappingRule = new Map<IAbsolutePathInfo, IAbsolutePathInfo>();
  const outerMappingRule = new Map<IAbsolutePathInfo, IAbsolutePathInfo>();
  for (const binding of bindings) {
    const mappingRule = createMappingRuleByBinding(innerState, binding);
    let primaryMappingRuleSet = primaryMappingRuleSetByElement.get(webComponent);
    if (typeof primaryMappingRuleSet === 'undefined') {
      primaryMappingRuleSetByElement.set(webComponent, new Set([mappingRule]));
    } else {
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

export function getInnerAbsolutePathInfo(webComponent: Element, outerAbsPathInfo: IAbsolutePathInfo): IAbsolutePathInfo | null {
  const mapping = outerMappingByElement.get(webComponent);
  if (typeof mapping === 'undefined') {
    return null;
  }
  return mapping.get(outerAbsPathInfo) ?? null;
}

export function getOuterAbsolutePathInfo(webComponent: Element, innerAbsPathInfo: IAbsolutePathInfo): IAbsolutePathInfo | null {
  let innerMapping = innerMappingByElement.get(webComponent);
  if (typeof innerMapping === 'undefined') {
    innerMapping = new Map<IAbsolutePathInfo, IAbsolutePathInfo>();
    innerMappingByElement.set(webComponent, innerMapping);
  }
  if (innerMapping.has(innerAbsPathInfo)) {
    return innerMapping.get(innerAbsPathInfo)!
  }
  let outerMapping = outerMappingByElement.get(webComponent);
  if (typeof outerMapping === 'undefined') {
    outerMapping = new Map<IAbsolutePathInfo, IAbsolutePathInfo>();
    outerMappingByElement.set(webComponent, outerMapping);
  }
  // 内側からのアクセスの場合、ルールがなければプライマリルールから新たにルールとバインディングを生成する
  const primaryMappingRuleSet = primaryMappingRuleSetByElement.get(webComponent);
  if (typeof primaryMappingRuleSet === 'undefined') {
    raiseError('Primary mapping rule set not found for web component.');
  }
  let primaryMappingRule: IMappingRule | null = null;
  for(const currentPrimaryMappingRule of primaryMappingRuleSet) {
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
    raiseError(
      `Mapping rule not found for inner path "${innerAbsPathInfo.pathInfo.path}". ` +
      `Did you forget to bind this property in the component's data-wcs attribute? ` +
      `Available mappings: ${Array.from(primaryMappingRuleSet).map(r => r.innerAbsPathInfo.pathInfo.path).join(', ')}`
    );
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
  const rootNode = webComponent.getRootNode() as Node;
  const outerStateElement = getStateElementByName(rootNode, primaryBinding.stateName);
  if (outerStateElement === null) {
    raiseError(`State element with name "${primaryBinding.stateName}" not found for web component.`);
  }
  const outerAbsPathInfo = getAbsolutePathInfo(outerStateElement, outerPathInfo);
  innerMapping.set(innerAbsPathInfo, outerAbsPathInfo);
  outerMapping.set(outerAbsPathInfo, innerAbsPathInfo);

  // ルールに対応するバインディングを生成
  const newBinding: IBindingInfo = {
    ...primaryBinding,
    propName: innerAbsPathInfo.pathInfo.path,
    propSegments: innerAbsPathInfo.pathInfo.segments,
    statePathName: outerAbsPathInfo.pathInfo.path,
    statePathInfo: outerAbsPathInfo.pathInfo,
  }
  addBindingByNode(webComponent, newBinding);

  return outerAbsPathInfo;
}