import { ILoopContext } from "../list/types";
import { IFragmentNodeInfo } from "../structural/types";
import { IInitialBindingInfo } from "./types";
export declare function initializeBindings(root: Document | Element, parentLoopContext: ILoopContext | null): IInitialBindingInfo;
export declare function initializeBindingsByFragment(root: DocumentFragment, nodeInfos: IFragmentNodeInfo[], loopContext: ILoopContext | null): IInitialBindingInfo;
//# sourceMappingURL=initializeBindings.d.ts.map