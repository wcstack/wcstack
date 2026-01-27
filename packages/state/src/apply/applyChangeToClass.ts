import { raiseError } from "../raiseError";

export function applyChangeToClass(element: Element, className: string, newValue: any): void {
  if (typeof newValue !== "boolean") {
    raiseError(`Invalid value for class application: expected boolean, got ${typeof newValue}`);
  }
  element.classList.toggle(className, newValue);
}