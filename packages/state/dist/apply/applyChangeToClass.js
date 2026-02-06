import { raiseError } from "../raiseError";
export function applyChangeToClass(binding, _context, newValue) {
    const element = binding.node;
    const className = binding.propSegments[1];
    if (typeof newValue !== 'boolean') {
        raiseError(`Invalid value for class application: expected boolean, got ${typeof newValue}`);
    }
    element.classList.toggle(className, newValue);
}
//# sourceMappingURL=applyChangeToClass.js.map