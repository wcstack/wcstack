import { products } from "../../domain/my-products.js";


export default class extends HTMLElement {
  _productId;
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get productId() {
    return this._productId;
  }
  set productId(value) {
    this._productId = value;
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    const productId = this.productId;
    const product = products.find(product => product.id === productId);
    if (product) {
      this.shadowRoot.innerHTML = `
        <h2>Product: ${product.name}</h2>
        <p>${product.summary}</p>
        <p>${product.description}</p>
        <wcs-link to="/products">Back to Products</wcs-link>
      `;
    }else {
      this.shadowRoot.innerHTML = `
        <h2>Product Not Found</h2>
        <p>The product with ID ${productId} does not exist.</p>
        <wcs-link to="/products">Back to Products</wcs-link>
      `;
    }
  }
}