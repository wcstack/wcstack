interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
}
interface IWcBindableInput {
    readonly name: string;
    readonly attribute?: string;
}
interface IWcBindableCommand {
    readonly name: string;
    readonly async?: boolean;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    readonly version: 1;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly contacts: string;
}
interface IWritableTagNames {
    contacts?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/** Field names selectable via the Contact Picker API's `properties` argument. */
type ContactProperty = "name" | "email" | "tel" | "address" | "icon";
/** Options for `select(properties, options)` — `multiple` defaults to `false`. */
interface ContactsSelectOptions {
    multiple?: boolean;
}
/**
 * A single contact returned by `navigator.contacts.select()`. Every field is an
 * array (a contact can have multiple emails, phone numbers, etc.) and only the
 * fields requested via `properties` are populated.
 */
interface ContactInfo {
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
interface WcsContactsCoreValues {
    value: ContactInfo[] | null;
    loading: boolean;
    error: any;
    cancelled: boolean;
}
/**
 * Value types for the Shell (`<wcs-contacts>`) — identical observable surface
 * to the Core. The Shell adds no inputs: `select(properties, options)`'s
 * arguments are per-call, not declarative attributes.
 */
type WcsContactsValues = WcsContactsCoreValues;

declare function bootstrapContacts(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Contact Picker primitive. A thin, framework-agnostic wrapper around
 * `navigator.contacts.select(properties, options)` exposed through the
 * wc-bindable protocol.
 *
 * This is the same simplified derivative of `FetchCore._doFetch` that
 * `@wcstack/share`'s `ShareCore` establishes (docs/contact-picker-tag-design.md
 * §1): single `_gen` generation guard, same-value-guarded private setters,
 * never-throw try/catch, no `AbortController`/`abort()` — the Contact Picker
 * API accepts no `AbortSignal` and, like the Web Share dialog, the picker is a
 * single system-modal surface (at most one open at a time).
 *
 * The one structural difference from `ShareCore`: `select()` takes **two**
 * positional arguments (`properties`, `options`) rather than one — the first
 * batch-3 member to do so. The command-token argument pass-through
 * (spec-proposal-command-token-arguments.md) does not special-case argument
 * count, so this requires no protocol change.
 */
declare class ContactsCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _value;
    private _loading;
    private _error;
    private _cancelled;
    private _gen;
    private _ready;
    constructor(target?: EventTarget);
    get ready(): Promise<void>;
    get value(): ContactInfo[] | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    observe(): Promise<void>;
    dispose(): void;
    private _setLoading;
    private _setValue;
    private _setError;
    private _setCancelled;
    private _api;
    select(properties: ContactProperty[], options?: ContactsSelectOptions): Promise<ContactInfo[] | null>;
}

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
declare class WcsContacts extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    constructor();
    get value(): ContactInfo[] | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    get connectedCallbackPromise(): Promise<void>;
    select(properties: ContactProperty[], options?: ContactsSelectOptions): Promise<ContactInfo[] | null>;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { ContactsCore, WcsContacts, bootstrapContacts, getConfig };
export type { ContactInfo, ContactProperty, ContactsSelectOptions, IWritableConfig, IWritableTagNames, WcsContactsCoreValues, WcsContactsValues };
