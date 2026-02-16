import { raiseError } from "../raiseError";
export function applyChangeToWebComponent(binding, _context, newValue) {
    const element = binding.node;
    const propSegments = binding.propSegments;
    if (propSegments.length <= 1) {
        raiseError(`Invalid propSegments for web component binding: ${propSegments.join(".")}`);
    }
    const [firstSegment, ...restSegments] = propSegments;
    const subObject = element[firstSegment];
    if (typeof subObject === "undefined") {
        raiseError(`Property "${firstSegment}" not found on web component.`);
    }
    subObject[restSegments.join(".")] = newValue;
}
//# sourceMappingURL=applyChangeToWebComponent.js.map