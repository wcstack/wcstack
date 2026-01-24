import { products } from "../../domain/my-products.js";

export default class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <h2>Product List</h2>
      <ul>
        ${products
          .map(
            (product) => `
              <li>
                <h3><wcs-link to="/products/${product.id}">${product.name}</wcs-link></h3>
                <p>${product.summary}</p>
              </li>
            `
          )
          .join('')}
      </ul>
    `;
  }
}
