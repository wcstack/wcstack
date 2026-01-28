
export function resolveNodePath(root: Node, path: number[]): Node | null {
  let currentNode = root;
  if (path.length === 0) return currentNode;
  // path.reduce()だと途中でnullになる可能性があるので、
  for(let i = 0; i < path.length; i++) {
    currentNode = currentNode?.childNodes[path[i]] ?? null;
    if (currentNode === null) break;
  }
  return currentNode;
}