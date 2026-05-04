// <pve-preview> custom element: live-renders the user's HTML source
// inside a sandboxed iframe via the `srcdoc` attribute. Debounced so
// that rapid keystrokes don't trigger a reload on every character.
//
// The iframe re-runs the full document on each srcdoc swap. wcstack's
// `auto` script + `<wcs-state>` registration happen inside the iframe,
// independently of this editor's outer wcstack instance.

const DEFAULT_DEBOUNCE_MS = 400;

const TEMPLATE = `
<style>
  :host {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    background: #fff;
    overflow: hidden;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
    display: block;
  }
  .badge {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 2px 8px;
    border-radius: 10px;
    background: rgba(20, 20, 20, 0.65);
    color: #aaa;
    font: 10px ui-monospace, monospace;
    pointer-events: none;
    transition: opacity 200ms;
  }
  .badge.idle { opacity: 0; }
</style>
<iframe sandbox="allow-scripts allow-modals allow-forms" referrerpolicy="no-referrer" title="wcstack preview"></iframe>
<div class="badge idle">live</div>
`;

class PvePreview extends HTMLElement {
  constructor() {
    super();
    this._source = '';
    this._timer = null;
    this._badgeTimer = null;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = TEMPLATE;

    if (Object.prototype.hasOwnProperty.call(this, 'source')) {
      const pending = this.source;
      delete this.source;
      this.source = pending;
    }
  }

  set source(v) {
    const next = v == null ? '' : String(v);
    if (next === this._source) return;
    this._source = next;
    this._scheduleUpdate();
  }
  get source() { return this._source; }

  set debounceMs(v) {
    this._debounceMs = Number.isFinite(+v) ? +v : DEFAULT_DEBOUNCE_MS;
  }
  get debounceMs() {
    return this._debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  connectedCallback() {
    if (this._source && !this._everRendered) this._update();
  }

  _scheduleUpdate() {
    if (this._timer) clearTimeout(this._timer);
    this._showBadge();
    this._timer = setTimeout(() => this._update(), this.debounceMs);
  }

  _update() {
    this._timer = null;
    const iframe = this.shadowRoot.querySelector('iframe');
    iframe.srcdoc = this._source;
    this._everRendered = true;
    this._fadeBadge();
  }

  _showBadge() {
    const b = this.shadowRoot.querySelector('.badge');
    b.textContent = 'updating…';
    b.classList.remove('idle');
    if (this._badgeTimer) clearTimeout(this._badgeTimer);
  }

  _fadeBadge() {
    const b = this.shadowRoot.querySelector('.badge');
    b.textContent = 'live';
    if (this._badgeTimer) clearTimeout(this._badgeTimer);
    this._badgeTimer = setTimeout(() => b.classList.add('idle'), 700);
  }
}

if (!customElements.get('pve-preview')) {
  customElements.define('pve-preview', PvePreview);
}
