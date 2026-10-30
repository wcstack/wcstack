// The dictionary's canonical home (docs/i18n-design.md §4-1, examples/router-i18n).
// It rests on one assumption: <html lang> is already right when this module is
// evaluated — the synchronous head script in index.html writes it first.
import { mergeAndFreeze } from "./merge.js";

export const SUPPORTED = ["ja", "en", "ar"];
const FALLBACK = "en";

const declared = document.documentElement.lang;
export const lang = SUPPORTED.includes(declared) ? declared : FALLBACK;
export const dir = lang === "ar" ? "rtl" : "ltr";

const [current, fallback] = await Promise.all([
  import(`./${lang}.js`),
  lang === FALLBACK ? null : import(`./${FALLBACK}.js`).catch(() => null),
]);

// Every key is in the English catalog (the fallback), so it gives the lint the
// dictionary's shape: the i18n.t.* bindings are checked against it.
/** @type {typeof import("./en.js").default} */
export const t = fallback === null
  ? mergeAndFreeze(current.default, current.default)
  : mergeAndFreeze(fallback.default, current.default);
