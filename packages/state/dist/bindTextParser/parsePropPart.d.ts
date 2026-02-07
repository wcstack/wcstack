import { IBindingInfo } from "../types";
type PropPartParseResult = Pick<IBindingInfo, 'propName' | 'propSegments' | 'propModifiers' | 'inFilters'>;
export declare function parsePropPart(propPart: string): PropPartParseResult;
export {};
//# sourceMappingURL=parsePropPart.d.ts.map