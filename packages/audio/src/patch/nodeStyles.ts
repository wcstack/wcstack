// Chain tags render nothing themselves, but they must not swallow the layout of
// any UI nested inside them, so they take `display: contents`.
//
// The stylesheet is adopted into the element's own root node — not injected into
// `document.head`. Only `<wcs-head>` writes to the document head, and doing it
// here would both break inside a shadow root and leave residue a page never
// asked for.
const CSS =
  "wcs-audio{display:block}" +
  "wcs-voice,wcs-osc,wcs-noise,wcs-biquad,wcs-gain,wcs-delay," +
  "wcs-shaper,wcs-env,wcs-lfo,wcs-analyser{display:contents}";

const applied = new WeakSet<Document | ShadowRoot>();

/** Idempotent: repeated roots and repeated calls adopt the sheet exactly once. */
export function applyNodeStyles(node: Node): void {
  const root = node as Document | ShadowRoot;
  if (applied.has(root)) return;
  const target = root as { adoptedStyleSheets?: CSSStyleSheet[] };
  if (!Array.isArray(target.adoptedStyleSheets) || typeof CSSStyleSheet !== "function") return;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    applied.add(root);
  } catch {
    // never-throw: an environment without constructable stylesheets simply gets
    // no default display rules; the graph still works.
  }
}

/** Test seam: forget which roots have been styled. */
export function resetNodeStyles(root: Document | ShadowRoot): void {
  applied.delete(root);
}
