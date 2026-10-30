// Intl formatters for the page's one locale, built once (docs/i18n-design.md §7).
// The library is in Tokyo: library times are always shown in Asia/Tokyo,
// whatever the reader's own zone is. The opening hours, due dates and fee
// dates are formatted in the templates with the date / time filters' zone
// (`time(,short,Asia/Tokyo)`, state 4.10); what stays here is what a filter
// cannot say — a date inside a sentence, the reader's own time with its
// weekday and zone name, the zone's name.
import { lang } from "./catalog.js";

export const LIBRARY_ZONE = "Asia/Tokyo";
export const readerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const plural = new Intl.PluralRules(lang);
export const number = new Intl.NumberFormat(lang);
export const yen = new Intl.NumberFormat(lang, { style: "currency", currency: "JPY" });
export const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });

// A hold kept until a Tokyo date and time, inside a sentence.
export const dateTimeTokyo = new Intl.DateTimeFormat(lang, { timeZone: LIBRARY_ZONE, dateStyle: "medium", timeStyle: "short" });
export const zoneNameTokyo = new Intl.DateTimeFormat(lang, { timeZone: LIBRARY_ZONE, timeZoneName: "long" })
  .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? LIBRARY_ZONE;
// The reader's own zone (only shown when it is not Tokyo).
export const timeReader = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit", weekday: "short", timeZoneName: "short" });

/** "YYYY-MM-DD" + "HH:MM" in Tokyo → the instant (Tokyo has no DST: +09:00). */
export function tokyoInstant(date, time = "00:00") {
  return new Date(`${date}T${time}:00+09:00`);
}

/**
 * A value of unknown direction inside a sentence (an English title or query
 * inside Arabic): wrapped in FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE, the
 * text equivalent of <bdi>, since a textContent binding cannot carry markup
 * (examples/router-i18n's README says so since 4.10).
 */
export function isolate(value) {
  return "⁨" + String(value ?? "") + "⁩";
}

/** Message application in one place: "{n} items" + { n } → text. */
export function fmt(message, args) {
  return String(message).replace(/\{(\w+)\}/g, (m, name) => (args[name] === undefined ? m : String(args[name])));
}

/** A plural group ({ one, other, … }) for n, with n formatted for the locale. */
export function pluralText(group, n) {
  const form = group[plural.select(n)] ?? group.other;
  return fmt(form, { n: number.format(n) });
}

/** "in 3 days" / "tomorrow" / "in 5 hours" from now to `target` (Date). */
export function relativeFrom(nowMs, target) {
  const diff = target.getTime() - nowMs;
  const hours = diff / 3600_000;
  if (Math.abs(hours) < 24) return rtf.format(Math.round(hours), "hour");
  return rtf.format(Math.round(hours / 24), "day");
}
