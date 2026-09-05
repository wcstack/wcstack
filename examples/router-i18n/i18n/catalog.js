/**
 * The dictionary's canonical home (docs/i18n-design.md §4-1).
 *
 * Everything else — the app state, the <wcs-state> projection, the Intl
 * formatters — reads from here. Module scope is not DOM scope, so a component
 * inside a shadow root imports the same instance the page does; there is no
 * cross-state read and no scope walk (§5).
 *
 * The whole file rests on one assumption: <html lang> is already correct when
 * this module is evaluated. The head snippet in index.html is a *synchronous*
 * script, and module scripts are deferred, so that ordering is structural
 * rather than a race we hope to win (V0-1).
 */
// The merge lives in ./merge.js so it can be unit-tested without a DOM (this
// module reads `document` at top level). Its contract — fully frozen, value
// descriptors only, no reference shared with a source — is what §4-1 and §12
// stand on.
import { mergeAndFreeze } from "./merge.js";

const FALLBACK = "en";

// Whatever the head snippet negotiated. It only ever writes a supported tag,
// so the guard below is belt-and-braces for someone loading this module from a
// page without the snippet.
const declared = document.documentElement.lang;
export const lang = declared === "ja" || declared === "en" ? declared : FALLBACK;

const [current, fallback] = await Promise.all([
  import(`./${lang}.js`),
  lang === FALLBACK ? null : import(`./${FALLBACK}.js`),
]);

export const t = fallback === null
  ? mergeAndFreeze(current.default, current.default)
  : mergeAndFreeze(fallback.default, current.default);
