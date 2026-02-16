import { raiseError } from "../raiseError";
import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";

export function applyChangeToWebComponent(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const element = binding.node as Element;
  const propSegments = binding.propSegments;
  if (propSegments.length <= 1) {
    raiseError(`Invalid propSegments for web component binding: ${propSegments.join(".")}`);
  }
  const [ firstSegment, ...restSegments ] = propSegments;
  const subObject = (element as any)[firstSegment] as Record<string, unknown> | undefined;
  if (typeof subObject === "undefined") {
    raiseError(`Property "${firstSegment}" not found on web component.`);
  }
  subObject[restSegments.join(".")] = newValue;
}
