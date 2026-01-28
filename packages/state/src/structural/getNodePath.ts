
export function getNodePath(node: Node): number[] {
  let currentNode: Node | null = node;
  const path: number[] = [];
  while(currentNode.parentNode !== null) {
    const nodes: Node[] = Array.from(currentNode.parentNode.childNodes);
    const index = nodes.indexOf(currentNode);
    path.unshift(index);
    currentNode = currentNode.parentNode;
  }
  return path;
}
