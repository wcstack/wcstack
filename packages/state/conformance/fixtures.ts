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

/** A Shadow DOM component the host mounts: a getter over the mount, a private key, a two-way input. */
class ConfCard extends HTMLElement {
  state: Record<string, any> = {
    mode: "view",
    get display() { return `${(this as any).name}!`; },
    toggle(this: any) { this.mode = this.mode === "view" ? "edit" : "view"; },
  };
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>`
      + `<span class="name">{{ name }}</span><span class="display">{{ display }}</span><span class="mode">{{ mode }}</span>`
      + `<input data-wcs="value: name"><button data-wcs="onclick: toggle">t</button>`;
  }
  type(v: string): void {
    const i = this.shadowRoot!.querySelector("input")!;
    i.value = v;
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }
  press(): void { (this.shadowRoot!.querySelector("button") as HTMLElement).click(); }
  setName(v: string): void { (this as any).state.name = v; }
}

/** A component over a list it is handed: `$1`, `$getAll` and event indexes count within it. */
class ConfList extends HTMLElement {
  state: Record<string, any> = {
    picked: -1,
    get "items.*.pos"() { return (this as any).$1; },
    get total() { return (this as any).$getAll("items.*.v", []).reduce((a: number, b: number) => a + b, 0); },
    pick(this: any, _e: Event, i: number) { this.picked = i; },
    bump(this: any) { this["items.0.v"] = this["items.0.v"] + 10; },
  };
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>`
      + `<ul><template data-wcs="for: items"><li data-wcs="onclick: pick">{{ .pos }}:{{ .v }}</li></template></ul>`
      + `<p class="total">{{ total }}</p><p class="picked">{{ picked }}</p>`;
  }
  clickRow(i: number): void { (this.shadowRoot!.querySelectorAll("li")[i] as HTMLElement).click(); }
  bump(): void { (this as any).state.bump(); }
}

/** A Light DOM component, filled when it connects. */
class ConfLight extends HTMLElement {
  state: Record<string, any> = {};
  connectedCallback(): void {
    if (this.childElementCount === 0) this.innerHTML = `<wcs-state bind-component="state"></wcs-state><span class="inner">{{ name }}</span>`;
  }
}

/** An unwired Shadow DOM component: an independent tree over its (frozen) state. */
class ConfSolo extends HTMLElement {
  state: Record<string, any> = Object.freeze({ message: "hi", count: 0 });
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state><p>{{ message }}:{{ count }}</p>`;
  }
  $stateReadyCallback(prop: string): Promise<void> {
    this.setAttribute("data-ready", prop);
    return Promise.resolve();
  }
  say(v: string): void {
    (this as any).state.message = v;
    (this as any).state.count = (this as any).state.count + 1;
  }
}

/** A self-referential component: each node mounts itself on its children (a tree of any depth). */
class ConfTree extends HTMLElement {
  state: Record<string, any> = {};
  connectedCallback(): void {
    if (this.shadowRoot !== null) return;
    this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>`
      + `<span>{{ value }}/{{ total }}</span><ul><template data-wcs="for: children"><li><conf-tree data-wcs="state: ."></conf-tree></li></template></ul>`;
  }
}

export function defineFixtures(): void {
  const defs: [string, CustomElementConstructor][] = [
    ["conf-counter", ConfCounter], ["conf-output", ConfOutput], ["conf-label", ConfLabel],
    ["conf-notifier", ConfNotifier], ["conf-fetch", ConfFetch],
    ["conf-card", ConfCard], ["conf-list", ConfList], ["conf-light", ConfLight], ["conf-solo", ConfSolo], ["conf-tree", ConfTree],
  ];
  for (const [tag, cls] of defs) if (customElements.get(tag) === undefined) customElements.define(tag, cls);
}
