import { getFilteredValue } from "./getFilteredValue";
export function applyChangeToRadio(binding, _context, newValue) {
    const element = binding.node;
    const elementValue = element.value;
    const elementFilteredValue = getFilteredValue(elementValue, binding.inFilters);
    element.checked = newValue === elementFilteredValue;
}
//# sourceMappingURL=applyChangeToRadio.js.map