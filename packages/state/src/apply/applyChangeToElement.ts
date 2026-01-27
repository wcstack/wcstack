import { applyChangeToAttribute } from "./applyChangeToAttribute";
import { applyChangeToClass } from "./applyChangeToClass";
import { applyChangeToProperty } from "./applyChangeToProperty";
import { applyChangeToStyle } from "./applyChangeToStyle";
import { applyChangeToSubObject } from "./applyChangeToSubObject";

export function applyChangeToElement(element: Element, propSegment: string[], newValue: string): void {
  if (propSegment.length === 0) {
    return;
  }
  const firstSegment = propSegment[0];
  if (firstSegment === "class") {
    applyChangeToClass(element, propSegment[1], newValue);
  } else if (firstSegment === "attr") {
    applyChangeToAttribute(element, propSegment[1], newValue);
  } else if (firstSegment === "style") {
    applyChangeToStyle(element, propSegment[1], newValue);
  } else {
    if (propSegment.length === 1) {
      applyChangeToProperty(element, firstSegment, newValue);
    } else {
      applyChangeToSubObject(element, propSegment, newValue);
    }
  }
  // const remainingSegments = propSegment.slice(1);
}