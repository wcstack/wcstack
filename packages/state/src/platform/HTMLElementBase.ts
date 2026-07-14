/**
 * Browser builds use the native HTMLElement. Headless runtimes receive an
 * inert base so the public module can be imported without installing DOM
 * globals; constructing components remains a browser-only operation.
 */
export const HTMLElementBase = (
  typeof HTMLElement === "undefined" ? class {} : HTMLElement
) as typeof HTMLElement;
