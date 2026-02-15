import { IAbsolutePathInfo } from "../address/types";
export interface IMappingRule {
    innerAbsPathInfo: IAbsolutePathInfo;
    outerAbsPathInfo: IAbsolutePathInfo;
}
export declare function buildPrimaryMappingRule(webComponent: Element): void;
export declare function getInnerAbsolutePathInfo(webComponent: Element, outerAbsPathInfo: IAbsolutePathInfo): IAbsolutePathInfo | null;
export declare function getOuterAbsolutePathInfo(webComponent: Element, innerAbsPathInfo: IAbsolutePathInfo): IAbsolutePathInfo | null;
//# sourceMappingURL=MappingRule.d.ts.map