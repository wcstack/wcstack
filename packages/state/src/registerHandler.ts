import { initializeBindings } from "./bindings/initializeBindings.js";
import { collectStructuralFragments } from "./structural/collectStructuralFragments.js";

export function registerHandler() {
  document.addEventListener("DOMContentLoaded", async () => {
    collectStructuralFragments(document);
    await initializeBindings(document.body, null);
  });
}
