import { applyToAttribute } from "./applyToAttribute";
import { applyToClass } from "./applyToClass";
import { applyToProperty } from "./applyToProperty";
import { applyToStyle } from "./applyToStyle";
import { applyToSubObject } from "./applyToSubObject";

export function applyToElement(element: Element, propSegment: string[], newValue: string): void {
  if (propSegment.length === 0) {
    return;
  }
  const firstSegment = propSegment[0];
  if (firstSegment === "class") {
    applyToClass(element, propSegment[1], newValue);
  } else if (firstSegment === "attr") {
    applyToAttribute(element, propSegment[1], newValue);
  } else if (firstSegment === "style") {
    applyToStyle(element, propSegment[1], newValue);
  } else {
    if (propSegment.length === 1) {
      applyToProperty(element, firstSegment, newValue);
    } else {
      applyToSubObject(element, propSegment, newValue);
    }
  }
  // const remainingSegments = propSegment.slice(1);
}