// Deep merge `over` onto `base` and deep-freeze the result. Copied from the
// shape of examples/router-i18n/i18n/merge.js: fully frozen, value
// descriptors only, no reference shared with a source.
export function mergeAndFreeze(base, over) {
  const out = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(over)])) {
    const b = base[key];
    const o = over[key];
    if (isPlainObject(b) && isPlainObject(o)) {
      out[key] = mergeAndFreeze(b, o);
    } else {
      const winner = o === undefined ? b : o;
      out[key] = isPlainObject(winner) ? mergeAndFreeze(winner, winner) : winner;
    }
  }
  return Object.freeze(out);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
