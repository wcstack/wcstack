import { createEmptyArray } from "../createEmptyArray";
import { getFilteredValue } from "./getFilteredValue";
const EMPTY_ARRAY = createEmptyArray();
export function applyChangeToCheckbox(binding, _context, newValue) {
    const element = binding.node;
    const elementValue = element.value;
    const elementFilteredValue = getFilteredValue(elementValue, binding.inFilters);
    const normalizedNewValue = Array.isArray(newValue) ? newValue : EMPTY_ARRAY;
    element.checked = normalizedNewValue.includes(elementFilteredValue);
}
//# sourceMappingURL=applyChangeToCheckbox.js.map