import { config } from "./config";
export function findStateElement(rootElement, stateName) {
    const retElement = rootElement.querySelector(`${config.tagNames.state}[name="${stateName}"]`);
    return retElement;
}
//# sourceMappingURL=findStateElement.js.map