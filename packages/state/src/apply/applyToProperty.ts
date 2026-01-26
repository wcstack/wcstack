
export function applyToProperty(element: Element, propName: string, newValue: any): void {
  const currentValue = (element as any)[propName];
  if (currentValue !== newValue) {
    (element as any)[propName] = newValue;
  }
}
