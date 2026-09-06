// Fallback catalog. Every key the app uses must exist here — catalog.js deep
// merges this under the active locale, so anything missing elsewhere lands on
// these strings rather than rendering empty.
export default {
  app: {
    title: "Order history",
    lead: "One catalog, two locales. The language switch is a real navigation, not a re-render.",
  },
  nav: {
    orders: "Orders",
    about: "About",
  },
  orders: {
    heading: "Your orders",
    empty: "No orders yet.",
    placed: "Placed",
    total: "Total",
    // Plural categories are Intl.PluralRules keys, not a hand-rolled scheme.
    // English needs "one"/"other"; Japanese needs only "other" (see ja.js).
    count: {
      one: "{n} order",
      other: "{n} orders",
    },
    status: {
      pending: "Pending",
      shipped: "Shipped",
      delivered: "Delivered",
      cancelled: "Cancelled",
    },
  },
  about: {
    heading: "About this demo",
    body: "The dictionary is an ES module, so a path getter can import it and a template can reach it through <wcs-state>. Switching locale reloads the page on purpose.",
    // Deliberately absent from ja.js — proves the fallback deep merge (S4).
    fallbackNote: "This sentence has no Japanese translation, so it falls back to English.",
  },
  langName: {
    en: "English",
    ja: "日本語",
  },
};
