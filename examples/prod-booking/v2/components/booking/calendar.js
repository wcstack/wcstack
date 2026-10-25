// <booking-calendar>: the day's slots of a room; a click selects one. Loaded by <wcs-autoloader>
// (@components/booking/ → this file) when the room page first renders. The host mounts its `calendar`
// object (`state: calendar`): `date`, `slots`, `selected` are the host's paths.
// `$features` names what this state needs; the split auto entry loads `list-keys` only when a calendar appears.
import { h } from "../dom.js";

export default class BookingCalendar extends HTMLElement {
  state = {
    $features: ["list-keys", "formats"],
    $listKeys: { slots: "start" },
    get dateObj() { return this.date ? new Date(this.date + "T00:00:00") : null; },
    get "slots.*.isSelected"() { return this["slots.*.start"] === this.selected; },
    pick() { this.selected = this["slots.*.start"]; },
  };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    if (this.shadowRoot.childNodes.length) return;
    this.shadowRoot.append(
      h("wcs-state", { "bind-component": "state" }),
      h("p", { class: "date", "data-wcs": "textContent: dateObj|date(medium)" }),
      h("ol", { class: "slots" },
        h("template", { "data-wcs": "for: slots" },
          h("li", {},
            h("button", { type: "button", class: "slot", "data-wcs": "onclick: pick; disabled: .booked; class.sel: .isSelected" },
              h("span", { "data-wcs": "textContent: .start" }), "–", h("span", { "data-wcs": "textContent: .end" }))))),
    );
  }
}
