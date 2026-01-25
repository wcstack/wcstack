import { initializeBindings } from "./initializeBindings";

export function registerHandler() {
  document.addEventListener("DOMContentLoaded", async () => {
    await initializeBindings(document.body, null);
  });
}
