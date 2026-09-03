/**
 * The app's own state. It imports the dictionary directly — no read through
 * the i18n mount (docs/i18n-design.md §5 / §6).
 *
 * Every row label below is the case that drove the whole design: a *dynamic*
 * key (`t.orders.status[code]`) that a binding path cannot express, because a
 * path is a normalized key with no subscripting. The row getter resolves it,
 * which is where the existing norm already puts computation.
 */
import { t } from "./i18n/catalog.js";
import { currency, date, plural } from "./i18n/format.js";

const ORDERS = [
  { id: "A-1041", status: "delivered", total: 12800, placedAt: "2026-07-14" },
  { id: "A-1042", status: "shipped", total: 5400, placedAt: "2026-08-02" },
  { id: "A-1043", status: "pending", total: 48000, placedAt: "2026-08-21" },
  { id: "A-1044", status: "cancelled", total: 3900, placedAt: "2026-08-25" },
];

export default {
  // Fed by <wcs-router data-wcs="path: path"> — an output-only wcBindable, so
  // the router writes and state reads. Structural rendering (for / if) has to
  // live outside <wcs-router>: the router stamps static nodes into the outlet,
  // and state renders everything that depends on data. Same division of labour
  // as examples/router-spa.
  path: "/",
  get isList() { return this.path === "/"; },

  orders: ORDERS,

  // The one value rendered through a *filter* rather than through Intl in a
  // getter. Filters read `config.locale`, which bootstrapState defaults to
  // <html lang> — so this line proves the whole chain without the page passing
  // a locale to anything. Compare /en (8/26/2026) with /ja (2026/8/26).
  generatedAt: new Date("2026-08-26T09:30:00Z"),

  // Dynamic key → row getter. `t` is frozen plain data, so this is a lookup,
  // not a reactive dependency: the dictionary cannot change under us.
  get "orders.*.statusLabel"() {
    return t.orders.status[this["orders.*.status"]];
  },

  // Formatting through Intl rather than through a `|filter`. Filters bake the
  // locale in at bind time, which is fine here but says nothing useful — doing
  // it in the getter keeps value and presentation in one readable place (§10).
  get "orders.*.totalText"() {
    return currency.format(this["orders.*.total"]);
  },

  get "orders.*.placedText"() {
    return date.format(new Date(this["orders.*.placedAt"]));
  },

  // Plural selection is Intl.PluralRules, not a hand-rolled n===1 check. In
  // Japanese this always picks "other"; in English it picks "one" for a single
  // order. No ICU parser, no dependency (§7).
  get orderCountText() {
    const n = this.orders.length;
    return t.orders.count[plural.select(n)].replace("{n}", n);
  },
};
