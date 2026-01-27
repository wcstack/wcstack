export function applyChangeToStyle(node: Element, styleName: string, newValue: any): void {
  const style = (node as HTMLElement).style;
  const currentValue = (style as any)[styleName];
  if (currentValue !== newValue) {
    (style as any)[styleName] = newValue;
  }
}