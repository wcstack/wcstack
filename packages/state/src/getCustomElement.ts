
const cache = new WeakMap<Node, string | null>();

export function getCustomElement(node: Node): string | null {
  const cached = cache.get(node);
  if (cached !== undefined) {
    return cached;
  }
  let value: string | null = null;
  try {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return value;
    }
    const element = node as Element;
    const tagName = element.tagName.toLowerCase();
    if (tagName.includes("-")) {
      return value = tagName;
    }
    if (element.hasAttribute("is")) {
      const is = element.getAttribute("is")!;
      if (is.includes("-")) {
        return value = is;
      }
    }
    return value;
  } finally {
    cache.set(node, value);
  }
}
