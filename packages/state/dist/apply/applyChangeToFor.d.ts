import { IListIndex } from "../list/types";
import { IContent } from "../structural/types";
import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";
export declare function __test_setContentByListIndex(node: Node, index: IListIndex, content: IContent | null): void;
export declare function __test_deleteLastNodeByNode(node: Node): void;
export declare function __test_deleteContentByNode(node: Node): void;
export declare function applyChangeToFor(bindingInfo: IBindingInfo, context: IApplyContext, newValue: unknown): void;
//# sourceMappingURL=applyChangeToFor.d.ts.map