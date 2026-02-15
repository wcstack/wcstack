import { waitInitializeBinding } from "./bindings/initializeBindingPromiseByNode";
import { initializeBindings } from "./bindings/initializeBindings";
import { convertMustacheToComments } from "./mustache/convertMustacheToComments";
import { collectStructuralFragments } from "./structural/collectStructuralFragments";
import { waitForStateInitialize } from "./waitForStateInitialize";

export async function buildBindings(root: Document | ShadowRoot): Promise<void> {
  if (root === document) {
    await waitForStateInitialize(document);
    convertMustacheToComments(document);
    collectStructuralFragments(document, document);
    initializeBindings(document.body, null);
  } else {
    const shadowRoot = root as ShadowRoot;
    await waitForStateInitialize(shadowRoot);
    convertMustacheToComments(shadowRoot);
    collectStructuralFragments(shadowRoot, shadowRoot);
    await waitInitializeBinding(shadowRoot.host);
    initializeBindings(shadowRoot, null);
  }
}
