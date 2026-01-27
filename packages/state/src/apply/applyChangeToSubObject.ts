
export function applyChangeToSubObject(
  element: Element,
  propSegment: string[],
  newValue: any
): void {
  const firstSegment = propSegment[0];
  let subObject = (element as any)[firstSegment];
  for (let i = 1; i < propSegment.length - 1; i++) {
    const segment = propSegment[i];
    if (subObject == null) {
      return;
    }
    subObject = subObject[segment];
  }
  const oldValue = subObject[propSegment[propSegment.length - 1]];
  if (oldValue !== newValue) {
    subObject[propSegment[propSegment.length - 1]] = newValue;
  }
}
