// <product-card> draws one product: the page hands it the product object
// (card.product = p). "Add to cart" is the page's business, so the card only
// says it was pressed: a bubbling "add-to-cart" event carrying the product id.
import { signal, h, SignalsElement } from "@wcstack/signals/dom";

const money = (n) => "$" + n.toFixed(2);

export class ProductCard extends SignalsElement {
  #product = signal(null);

  get product() { return this.#product.get(); }
  set product(value) { this.#product.set(value ?? null); }

  render() {
    const p = () => this.#product.get();
    const soldOut = () => p()?.stock === 0;
    return h("article", { class: () => (soldOut() ? "card sold-out" : "card") },
      h("div", { class: "card-icon" }, () => p()?.icon ?? ""),
      h("h3", null, h("a", { href: () => (p() ? "products/" + p().id : "") }, () => p()?.name ?? "")),
      h("p", null, () => p()?.description ?? ""),
      h("p", { class: "price" }, () => (p() ? money(p().price) : "")),
      h("p", { class: "badge", hidden: () => !soldOut() }, "Sold out"),
      h("button", {
        type: "button",
        disabled: () => !p() || soldOut(),
        onClick: () => this.dispatchEvent(new CustomEvent("add-to-cart", {
          bubbles: true, detail: { id: p()?.id },
        })),
      }, "Add to cart"),
    );
  }
}
customElements.define("product-card", ProductCard);
