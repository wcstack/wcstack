export interface ITagNames {
  readonly contacts: string;
}

export interface IWritableTagNames {
  contacts?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  tagNames?: IWritableTagNames;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

/** Field names selectable via the Contact Picker API's `properties` argument. */
export type ContactProperty = "name" | "email" | "tel" | "address" | "icon";

/** Options for `select(properties, options)` — `multiple` defaults to `false`. */
export interface ContactsSelectOptions {
  multiple?: boolean;
}

/**
 * A single contact returned by `navigator.contacts.select()`. Every field is an
 * array (a contact can have multiple emails, phone numbers, etc.) and only the
 * fields requested via `properties` are populated.
 */
export interface ContactInfo {
  name?: string[];
  email?: string[];
  tel?: string[];
  address?: unknown[];
  icon?: Blob[];
}

/**
 * Value types for ContactsCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ContactsCore();
 * bind(core, (name: keyof WcsContactsCoreValues, value) => { ... });
 * ```
 */
export interface WcsContactsCoreValues {
  // The array of contacts the user picked. `multiple` does not change the
  // shape — even a single selection resolves to a one-element array
  // (docs/contact-picker-tag-design.md §3). `null` before any successful
  // select().
  value: ContactInfo[] | null;
  loading: boolean;
  // A true platform failure (anything other than the user cancelling the
  // picker). `null` when there has been no failure yet or after a reset.
  error: any;
  // `true` when the user dismissed the contact picker (AbortError). Kept
  // separate from `error`, mirroring `@wcstack/share`'s `cancelled`
  // (docs/contact-picker-tag-design.md §1).
  cancelled: boolean;
}

/**
 * Value types for the Shell (`<wcs-contacts>`) — identical observable surface
 * to the Core. The Shell adds no inputs: `select(properties, options)`'s
 * arguments are per-call, not declarative attributes.
 */
export type WcsContactsValues = WcsContactsCoreValues;
