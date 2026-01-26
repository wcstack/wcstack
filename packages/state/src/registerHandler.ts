import { initializeBindings } from "./bindings/initializeBindings.js";

export function registerHandler() {
  document.addEventListener("DOMContentLoaded", async () => {
    await initializeBindings(document.body, null);
  });
}
