
const elementByUUID = new Map<string, Element>();

export function getElementByUUID(uuid: string): Element | null {
  return elementByUUID.get(uuid) || null;
}

export function setElementByUUID(uuid: string, element: Element | null): void {
  if (element === null) {
    elementByUUID.delete(uuid);
  } else {
    elementByUUID.set(uuid, element);
  }
}