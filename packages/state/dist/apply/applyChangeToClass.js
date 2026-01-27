import { raiseError } from "../raiseError";
export function applyChangeToClass(element, className, newValue) {
    if (typeof newValue !== "boolean") {
        raiseError(`Invalid value for class application: expected boolean, got ${typeof newValue}`);
    }
    element.classList.toggle(className, newValue);
}
//# sourceMappingURL=applyChangeToClass.js.map