import { config } from "./config";
export async function waitForStateInitialize(root) {
    const elements = root.querySelectorAll(config.tagNames.state);
    const promises = [];
    for (const element of elements) {
        const stateElement = element;
        promises.push(stateElement.initializePromise);
    }
    await Promise.all(promises);
}
//# sourceMappingURL=waitForStateInitialize.js.map