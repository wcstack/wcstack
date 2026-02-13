
export default class extends HTMLElement {
  state = {
    message: ""
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
<wcs-state bind-component="state">
</wcs-state>
<style>
  :host {
    display: block;
    margin-top: 0.75rem;
  }

  .card {
    border-radius: 10px;
    border: 1px solid #dbe4ff;
    background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%);
    padding: 0.65rem;
  }

  .title {
    font-size: 0.75rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: #1d4ed8;
    font-weight: 700;
    margin-bottom: 0.35rem;
  }

  .value {
    font-size: 0.95rem;
    color: #0f172a;
    margin-bottom: 0.45rem;
  }

  input {
    width: 100%;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    background: #fff;
    padding: 0.45rem 0.55rem;
    font-size: 0.9rem;
    outline: none;
    box-sizing: border-box;
  }

  input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
  }
</style>
<div class="card">
  <div class="title">Mirrored Message</div>
  <div class="value">{{ message }}</div>
  <input type="text" data-wcs="value: message" />
</div>
    `;
  }
} 
