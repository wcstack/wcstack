// <price-tag>: a room's price per hour in the currency the preferences choose. Loaded by <wcs-autoloader>
// (@components/price/ → this file); the host wires it with `state.amount: …; state.currency: …`.
import { h } from "../dom.js";

export default class PriceTag extends HTMLElement {
  state = {
    $features: ["formats"],
    amount: 0,
    currency: "JPY",
    get isUsd() { return this.currency === "USD"; },
    get usd() { return Math.round((this.amount / 150) * 100) / 100; },
  };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    if (this.shadowRoot.childNodes.length) return;
    this.shadowRoot.append(
      h("wcs-state", { "bind-component": "state" }),
      h("template", { "data-wcs": "if: isUsd" }, h("span", { "data-wcs": "textContent: usd|currency(USD,en-US)" })),
      h("template", { "data-wcs": "else:" }, h("span", { "data-wcs": "textContent: amount|currency(JPY,ja-JP)" })),
      h("span", { class: "per" }, "/h"),
    );
  }
}
