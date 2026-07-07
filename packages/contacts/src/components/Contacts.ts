import { ContactInfo, ContactProperty, ContactsSelectOptions, IWcBindable } from "../types.js";
import { ContactsCore } from "../core/ContactsCore.js";

/**
 * `<wcs-contacts>` — declarative Contact Picker API primitive.
 *
 * A thin command-only Shell (mirrors `<wcs-share>`): no attributes at all.
 * `select(properties, options)`'s arguments are per-call, not a declarative
 * setting to park on the element ahead of time.
 *
 * **Android Chrome only.** Desktop browsers entirely lack `navigator.contacts`
 * — treat `unsupported` as the default state, not an edge case, in any
 * example or consuming UI.
 */
export class WcsContacts extends HTMLElement {
  // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
  // connectedCallbackPromise so the state binder can await it uniformly across
  // all IO nodes before snapshotting.
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...ContactsCore.wcBindable,
    inputs: [],
    // Core の commands をそのまま継承（単一情報源）。
    commands: ContactsCore.wcBindable.commands,
  };

  private _core: ContactsCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new ContactsCore(this);
  }

  // --- Core delegated getters ---

  get value(): ContactInfo[] | null {
    return this._core.value;
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): any {
    return this._core.error;
  }

  get cancelled(): boolean {
    return this._core.cancelled;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Commands ---

  select(properties: ContactProperty[], options?: ContactsSelectOptions): Promise<ContactInfo[] | null> {
    return this._core.select(properties, options);
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}
