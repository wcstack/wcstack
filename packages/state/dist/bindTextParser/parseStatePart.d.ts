import { IBindingInfo } from "../types";
type StatePartParseResult = Pick<IBindingInfo, 'stateName' | 'statePathName' | 'statePathInfo' | 'filters'>;
export declare function parseStatePart(statePart: string): StatePartParseResult;
export {};
//# sourceMappingURL=parseStatePart.d.ts.map