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

/**
 * Merge `over` onto `base` and deep-freeze the result.
 *
 * Deep, not shallow: paths resolve segment by segment, so `t.orders.status` can
 * only work if `orders` is itself an object. A shallow merge would let a locale
 * that defines `orders.heading` wipe out `orders.status` entirely.
 *
 * Deep-frozen for the same reason: Object.freeze is shallow, so freezing only
 * the root would leave `t.orders` writable — and a writable nested object is
 * exactly where someone eventually adds a getter, which silently kills the
 * missing-key diagnostic (design §4-1 / §12).
 */
function mergeAndFreeze(base, over) {
  const out = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(over)])) {
    const b = base[key];
    const o = over[key];
    if (isPlainObject(b) && isPlainObject(o)) {
      out[key] = mergeAndFreeze(b, o);
    } else {
      out[key] = o === undefined ? b : o;
    }
  }
  return Object.freeze(out);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const t = fallback === null
  ? mergeAndFreeze(current.default, current.default)
  : mergeAndFreeze(fallback.default, current.default);
