
export function getCustomTagName(element: Element): string | null {
  const tagName = element.tagName.toLowerCase();
  if (tagName.includes("-")) {
    return tagName;
  }
  const isAttr = element.getAttribute("is");
  if (isAttr && isAttr.includes("-")) {
    return isAttr;
  }
  return null;
}