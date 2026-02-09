import { config } from "./config";
export async function waitForStateInitialize(root) {
    const elements = root.querySelectorAll(config.tagNames.state);
    const promises = [];
    await customElements.whenDefined(config.tagNames.state);
    for (const element of elements) {
        const stateElement = element;
        promises.push(stateElement.initializePromise);
    }
    await Promise.all(promises);
}
//# sourceMappingURL=waitForStateInitialize.js.map