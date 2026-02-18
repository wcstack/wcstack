
const cache = new WeakMap<Node, boolean>();

export function isCustomElement(node: Node): boolean {
  let value: boolean | undefined = cache.get(node);
  if (value !== undefined) {
    return value;
  }
  try {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return value = false;
    }
    const element = node as Element;
    if (element.tagName.includes("-")) {
      return value = true;
    }
    if (element.hasAttribute("is")) {
      if (element.getAttribute("is")?.includes("-")) {
        return value = true;
      }
    }
    return value = false;
  } finally {
    cache.set(node, value ?? false);
  }
}
