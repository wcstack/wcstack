// Which field is being composed with the IME, and the reading (kana) the user typed before converting.
//
// A two-way `value:` binding writes every composition step to state, and since 4.23 state does not write a
// field back while it is composed. What is left to the page is its own writes: the fields it formats by hand
// (phone, 〒, time, kana) are not rewritten under the IME, and the フリガナ is filled from the reading of a
// committed conversion — the kana in compositionupdate, gone once the text is converted (docs/forms.md).

const READING = /^[ぁ-ゖァ-ヺー]+$/;

let current = null;          // the element composing now
let lastReading = "";        // last all-kana composition text of the current composition
const committed = new WeakMap(); // element -> reading of its last committed composition
const listeners = new Set();

function targetOf(e) {
  // composition events from inside a shadow root (the year of <midori-date>) are retargeted to the host
  return e.composedPath?.()[0] ?? e.target;
}

document.addEventListener("compositionstart", (e) => {
  current = targetOf(e);
  lastReading = "";
}, true);

document.addEventListener("compositionupdate", (e) => {
  const data = e.data ?? "";
  if (READING.test(data)) lastReading = data;
}, true);

document.addEventListener("compositionend", (e) => {
  const el = targetOf(e);
  const data = e.data ?? "";
  // Committed without converting (やまだ stays やまだ) → the text itself is the reading.
  const reading = data === "" ? "" : READING.test(data) ? data : lastReading;
  committed.set(el, reading);
  if (current === el) current = null;
  lastReading = "";
  for (const fn of listeners) fn(el);
}, true);

// A field that loses focus mid-composition (the IME commits on blur) ends the composition as well.
document.addEventListener("focusout", (e) => {
  if (current && targetOf(e) === current) { /* compositionend follows in every browser; keep current until then */ }
}, true);

export const ime = {
  /** True while `el` (or anything inside it) is composing. */
  isComposing(el) { return !!current && (current === el || el?.contains?.(current) || el?.shadowRoot?.contains?.(current)); },
  /** The element composing now, or null. */
  get composingElement() { return current; },
  /** The reading of the composition `el` just committed (once). */
  takeReading(el) { const r = committed.get(el) ?? ""; committed.delete(el); return r; },
  onCompositionEnd(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
