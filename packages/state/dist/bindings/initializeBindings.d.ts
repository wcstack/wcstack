import { ILoopContext } from "../list/types";
import { IFragmentNodeInfo } from "../structural/types";
export declare function initializeBindings(root: Document | Element, parentLoopContext: ILoopContext | null): Promise<void>;
export declare function initializeBindingsByFragment(root: DocumentFragment, nodeInfos: IFragmentNodeInfo[], parentLoopContext: ILoopContext | null): Promise<void>;
//# sourceMappingURL=initializeBindings.d.ts.map