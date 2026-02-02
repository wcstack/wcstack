import { ILoopContext } from "../list/types";
import { IBindingInfo } from "../types";
import { IFragmentNodeInfo } from "../structural/types";
export declare function initializeBindings(root: Document | Element, parentLoopContext: ILoopContext | null): IBindingInfo[];
export declare function initializeBindingsByFragment(root: DocumentFragment, nodeInfos: IFragmentNodeInfo[], loopContext: ILoopContext | null): IBindingInfo[];
//# sourceMappingURL=initializeBindings.d.ts.map