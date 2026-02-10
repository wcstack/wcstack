
const rootNodeByFragment: WeakMap<DocumentFragment, Node> = new WeakMap();

export function setRootNodeByFragment(fragment: DocumentFragment, rootNode: Node | null): void {
  if (rootNode === null) {
    rootNodeByFragment.delete(fragment);
  } else {
    rootNodeByFragment.set(fragment, rootNode);
  }
}

export function getRootNodeByFragment(fragment: DocumentFragment): Node | null {
  return rootNodeByFragment.get(fragment) || null;
}
