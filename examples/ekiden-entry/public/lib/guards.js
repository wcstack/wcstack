// Route guards of the wizard. A guard cannot see the state tree and runs before state on page load
// (router-and-scaffold.md §4), so it reads the draft where <wcs-storage> keeps it.
import { firstIncompleteStep } from "./entry-logic.js";

export const DRAFT_KEY = "midori-ekiden-draft";
export const RECEIPT_KEY = "midori-ekiden-receipt";
const ORDER = ["team", "runners", "options", "confirm"];

function read(storage, key) {
  try { return JSON.parse(storage.getItem(key)); } catch { return null; }
}
export function readDraft() {
  const d = read(localStorage, DRAFT_KEY);
  return d && d.version === 1 ? d : null;
}

/** true to enter `step`, or the path of the first step that is not complete. */
export function guardStep(step) {
  if (step === "done") return read(sessionStorage, RECEIPT_KEY)?.id ? true : "/entry/team";
  const first = firstIncompleteStep(readDraft());
  return ORDER.indexOf(step) <= ORDER.indexOf(first) ? true : `/entry/${first}`;
}
/** `/` and `/entry`: continue where the draft was left (never past the first incomplete step). */
export function landing() {
  const d = readDraft();
  const first = firstIncompleteStep(d);
  const saved = ORDER.includes(d?.step) ? d.step : "team";
  return `/entry/${ORDER.indexOf(saved) <= ORDER.indexOf(first) ? saved : first}`;
}
