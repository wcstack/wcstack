import { IBindingInfo } from "../binding/types";
import { IApplyContext } from "./types";

export function applyChangeToText(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  if (binding.replaceNode.nodeValue !== newValue) {
    binding.replaceNode.nodeValue = newValue as string;
  }
}
