/**
 * wc-bindable custom elements used by the conformance scenarios. Defined identically in
 * the golden-recording run (current engine) and the comparison run (state-next).
 */

class ConfCounter extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [{ name: "value", event: "conf-counter:change" }],
    inputs: [{ name: "value", attribute: "value" }],
    commands: [{ name: "increment" }, { name: "reset" }],
  };
  private _value: unknown = 0;
  get value(): unknown { return this._value; }
  set value(v: unknown) { this._value = v; }
  increment(n: unknown = 1): void {
    this._value = (this._value as number) + (typeof n === "number" ? n : 1);
    this.dispatchEvent(new CustomEvent("conf-counter:change", { detail: this._value, bubbles: true }));
  }
  reset(): void {
    this._value = 0;
    this.dispatchEvent(new CustomEvent("conf-counter:change", { detail: 0, bubbles: true }));
  }
  /** The user changes the value (element → state). */
  userSet(v: unknown): void {
    this._value = v;
    this.dispatchEvent(new CustomEvent("conf-counter:change", { detail: v, bubbles: true }));
  }
}

/** Output-only: the element owns `status`, state only receives it. */
class ConfOutput extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [{ name: "status", event: "conf-output:status" }],
  };
  status = "ready";
  emitStatus(s: string): void {
    this.status = s;
    this.dispatchEvent(new CustomEvent("conf-output:status", { detail: s }));
  }
}

/** Input-only, mirrored to an attribute. */
class ConfLabel extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [],
    inputs: [{ name: "labelText", attribute: "label-text" }, { name: "data", attribute: "data" }],
  };
  labelText: unknown = "";
  data: unknown = null;
}

/** Emits `created` for an event token. */
class ConfNotifier extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [{ name: "created", event: "conf-notifier:created" }],
  };
  created: unknown = null;
  fire(detail: unknown): void {
    this.created = detail;
    this.dispatchEvent(new CustomEvent("conf-notifier:created", { detail }));
  }
}

/** A fetch-like element for spread: two outputs, one input, one command. */
class ConfFetch extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1,
    properties: [
      { name: "value", event: "conf-fetch:value" },
      { name: "loading", event: "conf-fetch:loading" },
    ],
    inputs: [{ name: "url" }],
    commands: [{ name: "load" }],
  };
  value: unknown = null;
  loading = false;
  url = "";
  load(): void {
    this.loading = true;
    this.dispatchEvent(new CustomEvent("conf-fetch:loading", { detail: true }));
    this.value = `data from ${this.url}`;
    this.dispatchEvent(new CustomEvent("conf-fetch:value", { detail: this.value }));
    this.loading = false;
    this.dispatchEvent(new CustomEvent("conf-fetch:loading", { detail: false }));
  }
}

export function defineFixtures(): void {
  const defs: [string, CustomElementConstructor][] = [
    ["conf-counter", ConfCounter], ["conf-output", ConfOutput], ["conf-label", ConfLabel],
    ["conf-notifier", ConfNotifier], ["conf-fetch", ConfFetch],
  ];
  for (const [tag, cls] of defs) if (customElements.get(tag) === undefined) customElements.define(tag, cls);
}
