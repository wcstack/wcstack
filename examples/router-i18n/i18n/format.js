/**
 * Intl formatters, built once at module scope (docs/i18n-design.md §7).
 *
 * This is only possible because the locale is fixed for the lifetime of the
 * page. Under live switching these would need a delivery path — a tag cache, a
 * state property, a filter argument — and none of the three is pleasant. That
 * whole question disappeared with D1.
 */
import { lang } from "./catalog.js";

export const number = new Intl.NumberFormat(lang);
export const currency = new Intl.NumberFormat(lang, { style: "currency", currency: "JPY" });
export const date = new Intl.DateTimeFormat(lang, { dateStyle: "medium" });
export const plural = new Intl.PluralRules(lang);
export const languageName = new Intl.DisplayNames([lang], { type: "language" });
