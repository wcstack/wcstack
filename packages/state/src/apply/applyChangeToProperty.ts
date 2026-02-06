import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";

export function applyChangeToProperty(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const element = binding.node as Element;
  const propSegments = binding.propSegments;
  if (propSegments.length === 1) {
    const firstSegment = propSegments[0];
    if ((element as any)[firstSegment] !== newValue) {
      (element as any)[firstSegment] = newValue;
    }
    return;
  }
  const firstSegment = propSegments[0];
  let subObject = (element as any)[firstSegment];
  for (let i = 1; i < propSegments.length - 1; i++) {
    const segment = propSegments[i];
    if (subObject == null) {
      return;
    }
    subObject = subObject[segment];
  }
  const oldValue = subObject[propSegments[propSegments.length - 1]];
  if (oldValue !== newValue) {
    subObject[propSegments[propSegments.length - 1]] = newValue;
  }
}
