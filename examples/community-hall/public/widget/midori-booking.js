// みどり市民会館 予約ウィジェット — paste on a partner's page:
//   <script type="module" src="https://<hall>/widget/midori-booking.js"></script>
//   <midori-booking event="12"></midori-booking>
//
// The partner's page may run its own wcstack (旅館みどり荘 runs 4.17.0 for its contact form). A second copy of
// @wcstack/state on the page does nothing ([wcs/package-twice]): the widget would run on the partner's version.
// So the widget defines its own wcstack into a scoped CustomElementRegistry and gives it to its shadow root
// (docs/islands.md; Chromium 146+ and Safari 26). Where the browser has no scoped registries (Firefox) the widget does not start: it shows a link
// to the hall's page instead of silently running on the partner's wcstack.
// The shadow root also keeps the partner's stylesheet out of the widget (and the widget's out of the partner's page).
import { bootstrapState } from "https://esm.run/@wcstack/state";
import { bootstrapSse } from "https://esm.run/@wcstack/sse";

const HALL = new URL(import.meta.url).origin;
const TAG = "midori-booking";

function scopedRegistrySupported() {
  try {
    new CustomElementRegistry();          // "Illegal constructor" where scoped registries do not exist
    return "initialize" in CustomElementRegistry.prototype;
  } catch {
    return false;
  }
}

let registry = null;
function widgetRegistry() {
  if (!registry) {
    registry = new CustomElementRegistry();
    bootstrapSse(undefined, registry);
    bootstrapState(undefined, registry);   // state last, as on a page
  }
  return registry;
}

const markupCache = new Map();
function loadMarkup(eventId) {
  if (!markupCache.has(eventId)) {
    const p = fetch(`${HALL}/widget/markup?event=${encodeURIComponent(eventId)}`).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
    p.catch(() => markupCache.delete(eventId));   // try again next time
    markupCache.set(eventId, p);
  }
  return markupCache.get(eventId);
}

// The two sentences that cannot come from the hall's templates: the hall cannot be reached, or the browser cannot run
// the widget. Everything else the widget says is in templates/widget.html.
const FALLBACK_STYLE = `<style>:host{display:block;font:15px/1.6 system-ui,sans-serif;color:#1d2320}
.box{border:1px solid #c8d3cc;border-radius:8px;padding:12px 16px;background:#fff}.box a{color:#1f6f43}</style>`;
const offline = (id) => `${FALLBACK_STYLE}<div class="box" role="status">みどり市民会館につながりません。
  <a href="${HALL}/events/${id}" target="_blank" rel="noopener">会館のサイトで見る</a>
  <button type="button" data-retry>もう一度試す</button></div>`;
const unsupported = (id) => `${FALLBACK_STYLE}<div class="box">このブラウザーでは予約ウィジェットを表示できません。
  <a href="${HALL}/events/${id}" target="_blank" rel="noopener">みどり市民会館のサイトで予約する</a></div>`;
const placeholder = `${FALLBACK_STYLE}<div class="box" aria-busy="true">…</div>`;

class MidoriBooking extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;          // moved within the page: keep what is there
    const id = this.getAttribute("event");
    // Turbo shows a cached copy of the page before the real one arrives (data-turbo-preview): that copy is thrown
    // away a moment later, so it gets a placeholder — no connection, no request.
    if (document.documentElement.hasAttribute("data-turbo-preview")) {
      this.attachShadow({ mode: "open" }).innerHTML = placeholder;
      return;
    }
    if (!scopedRegistrySupported()) {
      this.attachShadow({ mode: "open" }).innerHTML = unsupported(id);
      return;
    }
    const shadow = this.attachShadow({ mode: "open", customElementRegistry: widgetRegistry() });
    this.#render(shadow, id);
  }

  async #render(shadow, id) {
    shadow.innerHTML = placeholder;
    try {
      const markup = await loadMarkup(id);
      if (!this.isConnected) return;
      shadow.innerHTML = markup;           // parsed in the shadow root, so its wcs-* tags use the widget's registry
    } catch {
      shadow.innerHTML = offline(id);
      shadow.querySelector("[data-retry]").addEventListener("click", () => this.#render(shadow, id), { once: true });
    }
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, MidoriBooking);
