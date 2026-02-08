import { IBindingInfo } from "../types";
type StatePartParseResult = Pick<IBindingInfo, 'stateName' | 'statePathName' | 'statePathInfo' | 'stateAbsolutePathInfo' | 'outFilters'>;
export declare function parseStatePart(statePart: string): StatePartParseResult;
export {};
//# sourceMappingURL=parseStatePart.d.ts.map