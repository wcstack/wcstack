/**
 * The <wcs-state name="i18n"> projection (docs/i18n-design.md §4-2).
 *
 * Three lines, and deliberately nothing more. This exists so templates can
 * write `text: app.title@i18n`; it is not a second home for the dictionary.
 *
 * `<wcs-state src>` takes the module's **default export** and nothing else, so
 * `export { lang, t }` alone would leave the state empty.
 */
import { lang, t } from "./catalog.js";

export default { lang, t };
