
export function optimizeFragment(fragment: DocumentFragment): void {
  const childNodes = Array.from(fragment.childNodes);
  for(const childNode of childNodes) {
    if (childNode.nodeType === Node.TEXT_NODE) {
      const textContent = childNode.textContent || '';
      if (textContent.trim() === '') {
        // Remove empty text nodes
        fragment.removeChild(childNode);
      }
    }
  }
}
