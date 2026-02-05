import { setLoopContextByNode } from "../list/loopContextByNode";
import { ILoopContext } from "../list/types";
import { IContent } from "../structural/types";
import { getNodesByContent } from "./nodesByContent";

export function bindLoopContextToContent(content: IContent, loopContext: ILoopContext | null): void {
  const nodes = getNodesByContent(content);
  for(const node of nodes) {
    setLoopContextByNode(node, loopContext);
  }
}

export function unbindLoopContextToContent(content: IContent): void {
  const nodes = getNodesByContent(content);
  for(const node of nodes) {
    setLoopContextByNode(node, null);
  }
}
