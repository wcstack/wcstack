import { waitInitializeBinding } from "./bindings/initializeBindingPromiseByNode";
import { initializeBindings } from "./bindings/initializeBindings";
import { convertMustacheToComments } from "./mustache/convertMustacheToComments";
import { collectStructuralFragments } from "./structural/collectStructuralFragments";
import { waitForStateInitialize } from "./waitForStateInitialize";
export async function buildBindings(root) {
    if (root === document) {
        await waitForStateInitialize(document);
        convertMustacheToComments(document);
        collectStructuralFragments(document, document);
        initializeBindings(document.body, null);
    }
    else {
        const shadowRoot = root;
        await waitForStateInitialize(shadowRoot);
        convertMustacheToComments(shadowRoot);
        collectStructuralFragments(shadowRoot, shadowRoot);
        await waitInitializeBinding(shadowRoot.host);
        initializeBindings(shadowRoot, null);
    }
}
//# sourceMappingURL=buildBindings.js.map