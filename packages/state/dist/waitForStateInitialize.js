import { config } from "./config";
export async function waitForStateInitialize() {
    const elements = document.querySelectorAll(config.tagNames.state);
    const promises = [];
    for (const element of elements) {
        const stateElement = element;
        promises.push(stateElement.initializePromise);
    }
    await Promise.all(promises);
}
//# sourceMappingURL=waitForStateInitialize.js.map