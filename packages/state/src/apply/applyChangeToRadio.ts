import { IBindingInfo } from "../types";
import { getFilteredValue } from "./getFilteredValue";
import { IApplyContext } from "./types";

export function applyChangeToRadio(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const element = binding.node as HTMLInputElement;
  const elementValue = element.value;
  const elementFilteredValue = getFilteredValue(elementValue, binding.inFilters);
  element.checked = newValue === elementFilteredValue;
}
