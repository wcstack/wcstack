import { IFragmentNodeInfo } from "../structural/types";
import { IBindingInfo } from "../types";
export declare function collectNodesAndBindingInfos(root: Document | Element | DocumentFragment): [Node[], IBindingInfo[]];
export declare function collectNodesAndBindingInfosByFragment(root: DocumentFragment, nodeInfos: IFragmentNodeInfo[]): [Node[], IBindingInfo[]];
export declare function unregisterNode(node: Node): void;
//# sourceMappingURL=collectNodesAndBindingInfos.d.ts.map