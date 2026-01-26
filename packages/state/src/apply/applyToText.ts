
export function applyToText(node: Text, newValue: string): void {
  if (node.nodeValue !== newValue) {
    node.nodeValue = newValue;
  }
}
