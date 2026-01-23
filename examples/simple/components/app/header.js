
export default class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
    <section>
      <nav>
        <wcs-link to="/">Home</wcs-link>
        <wcs-link to="/about">About</wcs-link>
        <wcs-link to="/fail">Link fail</wcs-link>
      </nav>
    </section>
    `;
  }
}