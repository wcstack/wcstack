/**
 * The <wcs-state mount="i18n"> volume (docs/i18n-design.md §4-2).
 *
 * Three lines, and deliberately nothing more. This exists so templates can
 * write `text: i18n.t.app.title`; it is not a second home for the dictionary.
 *
 * `<wcs-state src>` takes the module's **default export** and nothing else, so
 * `export { lang, t }` alone would leave the state empty.
 */
import { lang, t } from "./catalog.js";

export default { lang, t };
