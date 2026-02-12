import { createEmptyArray } from "../createEmptyArray";
import { IBindingInfo } from "../types";
import { getFilteredValue } from "./getFilteredValue";
import { IApplyContext } from "./types";

const EMPTY_ARRAY = createEmptyArray<unknown>();

export function applyChangeToCheckbox(binding: IBindingInfo, _context: IApplyContext, newValue: unknown): void {
  const element = binding.node as HTMLInputElement;
  const elementValue = element.value;
  const elementFilteredValue = getFilteredValue(elementValue, binding.inFilters);
  const normalizedNewValue = Array.isArray(newValue) ? newValue : EMPTY_ARRAY;
  element.checked = normalizedNewValue.includes(elementFilteredValue);
}
