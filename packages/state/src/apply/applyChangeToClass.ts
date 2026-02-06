import { raiseError } from "../raiseError";
import { IBindingInfo } from "../types";
import { IApplyContext } from "./types";

export function applyChangeToClass(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const element = binding.node as Element;
  const className = binding.propSegments[1];
  if (typeof newValue !== 'boolean') {
    raiseError(`Invalid value for class application: expected boolean, got ${typeof newValue}`);
  }
  element.classList.toggle(className, newValue as boolean);
}