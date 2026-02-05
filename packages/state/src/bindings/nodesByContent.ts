import { IContent } from "../structural/types";

const nodesByContent: WeakMap<IContent, Node[]> = new WeakMap();

export function getNodesByContent(content: IContent): Node[] {
  return nodesByContent.get(content) ?? [];
}

export function setNodesByContent(content: IContent, nodes: Node[]): void {
  nodesByContent.set(content, nodes);
}
