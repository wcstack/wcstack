interface ITagNames {
    readonly permission: string;
}
interface IWritableTagNames {
    permission?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}
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
    readonly version: number;
    readonly properties: IWcBindableProperty[];
    readonly inputs?: IWcBindableInput[];
    readonly commands?: IWcBindableCommand[];
}
/**
 * Permission state mirroring the Permissions API `PermissionState`
 * (`"prompt"` / `"granted"` / `"denied"`) plus `"unsupported"` for environments
 * without `navigator.permissions`, or where the requested permission name cannot
 * be queried (the browser rejects the descriptor). This is the same four-value
 * surface used by `@wcstack/geolocation` and `@wcstack/clipboard`.
 */
type PermissionStateOrUnsupported = "prompt" | "granted" | "denied" | "unsupported";
/**
 * Descriptor passed to `navigator.permissions.query()`. `name` is the permission
 * name (e.g. `"geolocation"`, `"notifications"`, `"camera"`). The optional fields
 * cover the descriptors that take extra members:
 * - `userVisibleOnly` — required by the `"push"` permission.
 * - `sysex` — used by the `"midi"` permission.
 *
 * Other members defined by future descriptors are allowed via the index
 * signature so the Shell can forward unknown attributes without a type change.
 */
interface WcsPermissionDescriptor {
    name: string;
    userVisibleOnly?: boolean;
    sysex?: boolean;
    [key: string]: unknown;
}
/**
 * Value types for PermissionCore (headless) — the observable state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new PermissionCore({ name: "geolocation" });
 * bind(core, (name: keyof WcsPermissionCoreValues, value) => { ... });
 * ```
 */
interface WcsPermissionCoreValues {
    state: PermissionStateOrUnsupported;
    granted: boolean;
    denied: boolean;
    prompt: boolean;
    unsupported: boolean;
}
/**
 * Value types for the Shell (`<wcs-permission>`) — identical observable surface
 * to the Core. The Shell adds no command-property: the Permissions API is
 * read-only, so this element is a pure element → state monitor.
 */
type WcsPermissionValues = WcsPermissionCoreValues;
/**
 * Settable input surface for the Shell (`<wcs-permission>`) — the descriptor
 * members exposed as attributes (`name`, `user-visible-only`, `sysex`). Mirrors
 * the `inputs` entries of the wc-bindable manifest; use it for compile-time typing
 * when a binding system or tooling writes these declaratively.
 */
interface WcsPermissionInputs {
    name: string;
    userVisibleOnly: boolean;
    sysex: boolean;
}

declare function bootstrapPermission(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless permission-state primitive. A thin, framework-agnostic wrapper around
 * the Permissions API exposed through the wc-bindable protocol.
 *
 * Unlike the other @wcstack IO nodes (geolocation / clipboard / sse / …), the
 * Permissions API is **read-only**: it has `query()` but no standard `request()`.
 * Asking the user for a grant is the job of the feature node (`<wcs-geo>` etc.);
 * this node only *observes*. It is therefore a pure element → state monitor with
 * **no commands** — command-token does not apply, only event-token.
 *
 * The single observable is `state` (`navigator.permissions.query(descriptor)`'s
 * `PermissionState`, or `"unsupported"`), published via the `wcs-permission:change`
 * event. `granted` / `denied` / `prompt` / `unsupported` are convenience booleans
 * derived from that one event (mirroring how GeolocationCore exposes latitude/…
 * from one `wcs-geo:position` event), so a binding like `hidden@granted` works
 * directly. The live `change` event of the PermissionStatus is tracked so a grant
 * flipping in browser settings flows into the declarative state.
 */
declare class PermissionCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _descriptor;
    private _state;
    private _permissionStatus;
    private _permissionSubscribed;
    private _permGen;
    private _ready;
    constructor(descriptor?: WcsPermissionDescriptor | null, target?: EventTarget);
    get state(): PermissionStateOrUnsupported;
    get granted(): boolean;
    get denied(): boolean;
    get prompt(): boolean;
    get unsupported(): boolean;
    /** Resolves once the current (or initial) query settles. */
    get ready(): Promise<void>;
    private _setState;
    /**
     * Start observing `descriptor` (e.g. `{ name: "geolocation" }`). Idempotent
     * while already subscribed — calling it again only updates the stored descriptor
     * for a *future* re-subscription; it does **not** re-query, even when called with
     * a different descriptor (the Shell binds at a fixed connect-time descriptor and
     * does not re-query on a `name` change in v1). To switch permission mid-life,
     * dispose() first, then observe() the new descriptor. On the first call, or after
     * a dispose(), it issues the query and subscribes to the live `change` event.
     * Returns a promise that resolves once that query settles, for SSR.
     */
    observe(descriptor: WcsPermissionDescriptor): Promise<void>;
    /**
     * Detach the live permission `change` listener. Call from the Shell's
     * `disconnectedCallback` so a removed element does not leak the subscription.
     * A later reconnect can re-subscribe via observe().
     *
     * Headless callers (using PermissionCore directly, without the Shell) own this
     * lifecycle themselves: call dispose() when the observer is no longer needed,
     * otherwise the live PermissionStatus `change` listener keeps this instance
     * reachable for as long as the status is alive. dispose() is safe to call when
     * never subscribed and may be paired with a later observe() to resume.
     */
    dispose(): void;
    private _initPermission;
    private _onPermissionChange;
}

declare class WcsPermission extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    constructor();
    get name(): string;
    set name(value: string);
    get userVisibleOnly(): boolean;
    set userVisibleOnly(value: boolean);
    get sysex(): boolean;
    set sysex(value: boolean);
    get state(): PermissionStateOrUnsupported;
    get granted(): boolean;
    get denied(): boolean;
    get prompt(): boolean;
    get unsupported(): boolean;
    get connectedCallbackPromise(): Promise<void>;
    private _descriptor;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { PermissionCore, WcsPermission, bootstrapPermission, getConfig };
export type { IWritableConfig, IWritableTagNames, PermissionStateOrUnsupported, WcsPermissionCoreValues, WcsPermissionDescriptor, WcsPermissionInputs, WcsPermissionValues };
