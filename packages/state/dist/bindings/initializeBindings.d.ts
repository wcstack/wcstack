import { ILoopContext } from "../list/types";
import { IFragmentNodeInfo } from "../structural/types";
import { IInitialBindingInfo } from "./types";
export declare function initializeBindings(root: Document | Element, parentLoopContext: ILoopContext | null): void;
export declare function initializeBindingsByFragment(root: DocumentFragment, nodeInfos: IFragmentNodeInfo[]): IInitialBindingInfo;
//# sourceMappingURL=initializeBindings.d.ts.map