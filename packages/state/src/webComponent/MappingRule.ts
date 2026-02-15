import { IAbsolutePathInfo } from "../address/types";

export interface IMappingRule {
  innerAbsPathInfo: IAbsolutePathInfo;
  outerAbsPathInfo: IAbsolutePathInfo;
}

const _innerMapping: WeakMap<HTMLElement, Map<IAbsolutePathInfo, IAbsolutePathInfo>> = new WeakMap();
const _outerMapping: WeakMap<HTMLElement, Map<IAbsolutePathInfo, IAbsolutePathInfo>> = new WeakMap();
const _principalMappingRule: WeakMap<HTMLElement, IMappingRule> = new WeakMap();
