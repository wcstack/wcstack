import { waitInitializeBinding } from "../bindings/initializeBindingPromiseByNode";
import { convertMustacheToComments } from "../mustache/convertMustacheToComments";
import { raiseError } from "../raiseError";
import { collectStructuralFragments } from "../structural/collectStructuralFragments";
import { waitForStateInitialize } from "../waitForStateInitialize";
const registeredWebComponents = new WeakSet();
export async function registerWebComponent(webComponent) {
    if (!registeredWebComponents.has(webComponent)) {
        if (webComponent.shadowRoot === null) {
            raiseError('Component has no shadow root.');
        }
        registeredWebComponents.add(webComponent);
        const shadowRoot = webComponent.shadowRoot;
        await waitForStateInitialize(shadowRoot);
        convertMustacheToComments(shadowRoot);
        collectStructuralFragments(shadowRoot, shadowRoot);
        await waitInitializeBinding(webComponent);
    }
}
export function isWebComponentRegistered(webComponent) {
    return registeredWebComponents.has(webComponent);
}
//# sourceMappingURL=registerWebComponent.js.map