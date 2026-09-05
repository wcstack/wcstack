/**
 * Merge `over` onto `base` and deep-freeze the result (docs/i18n-design.md §4-1).
 *
 * Deep, not shallow: paths resolve segment by segment, so `t.orders.status` can
 * only work if `orders` is itself an object. A shallow merge would let a locale
 * that defines `orders.heading` wipe out `orders.status` entirely.
 *
 * Deep-frozen for the same reason: Object.freeze is shallow, so freezing only
 * the root would leave `t.orders` writable — and a writable nested object is
 * exactly where someone eventually adds a getter, which silently kills the
 * missing-key diagnostic (design §4-1 / §12).
 *
 * The result must also share **no reference with either source**. A subtree
 * present in only one catalog is copied and frozen like any other — returning
 * it by reference would leave that one branch unfrozen and would carry a source
 * getter through, descriptor and all, which is exactly the hole the freeze
 * exists to close. Copying by property *read* (never by descriptor) is equally
 * deliberate: a getter that somehow exists on a source is evaluated here, once,
 * into a plain value. Pinned by e2e/tests/router-i18n.spec.ts.
 */
export function mergeAndFreeze(base, over) {
  const out = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(over)])) {
    const b = base[key];
    const o = over[key];
    if (isPlainObject(b) && isPlainObject(o)) {
      out[key] = mergeAndFreeze(b, o);
    } else {
      const winner = o === undefined ? b : o;
      // A subtree present on one side only is still copied — never aliased.
      out[key] = isPlainObject(winner) ? mergeAndFreeze(winner, winner) : winner;
    }
  }
  return Object.freeze(out);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
