import { initializeBindings } from "./bindings/initializeBindings.js";
import { convertMustacheToComments } from "./mustache/convertMustacheToComments.js";
import { collectStructuralFragments } from "./structural/collectStructuralFragments.js";
import { waitForStateInitialize } from "./waitForStateInitialize.js";
export function registerHandler() {
    document.addEventListener("DOMContentLoaded", async () => {
        await waitForStateInitialize();
        convertMustacheToComments(document);
        collectStructuralFragments(document);
        initializeBindings(document.body, null);
    });
}
//# sourceMappingURL=registerHandler.js.map