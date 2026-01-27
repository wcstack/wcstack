
export function applyChangeToText(node: Text, newValue: string): void {
  if (node.nodeValue !== newValue) {
    node.nodeValue = newValue;
  }
}
