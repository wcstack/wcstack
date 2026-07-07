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
    readonly credential: string;
}
interface IWritableTagNames {
    credential?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

/**
 * v1 scope: password/federated credentials only (docs/credential-tag-design.md
 * §0). `publicKey` (WebAuthn) is a much larger surface — attestation,
 * authenticator selection, platform vs cross-platform, RP configuration —
 * that deserves its own dedicated node in a future batch. This Core validates
 * and strips a `publicKey` key if a caller passes one, rather than silently
 * forwarding it (which would accidentally support WebAuthn through a side
 * door this package explicitly does not claim to support).
 */
interface CredentialGetOptions {
    password?: boolean;
    federated?: {
        providers?: string[];
        protocols?: string[];
    };
    mediation?: "silent" | "optional" | "required";
    signal?: AbortSignal;
}
/** A password or federated credential, as accepted by `navigator.credentials.store()`. */
type StorableCredential = Credential;
/**
 * Value types for CredentialCore (headless) — the observable state properties.
 */
interface WcsCredentialCoreValues {
    value: Credential | null;
    loading: boolean;
    error: any;
    cancelled: boolean;
}
/**
 * Value types for the Shell (`<wcs-credential>`) — identical observable
 * surface to the Core.
 */
type WcsCredentialValues = WcsCredentialCoreValues;

declare function bootstrapCredential(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless Credential Management primitive. A thin, framework-agnostic
 * wrapper around `navigator.credentials.get()`/`.store()` exposed through the
 * wc-bindable protocol.
 *
 * Reuses batch3's "thin command" archetype established by `@wcstack/share`
 * (docs/credential-tag-design.md): single `_gen` generation guard,
 * same-value-guarded private setters, never-throw try/catch, no
 * `AbortController`/`abort()` command.
 *
 * **v1 scope excludes WebAuthn (`publicKey`)** — see docs/credential-tag-design.md
 * §0. `get()` validates and strips a `publicKey` option rather than silently
 * forwarding it, surfacing the attempt as a scope-violation `error` instead of
 * accidentally supporting WebAuthn through a side door.
 *
 * **`get()`/`store()` share one `_gen`** — an accepted v1 simplification
 * (docs/multi-promise-io-node-design.md): these two operations are used
 * sequentially in real auth flows (store after a successful login, get before
 * attempting one), not naturally concurrently on the same instance. If both
 * ARE invoked concurrently on the same `<wcs-credential>`, the later call's
 * generation bump silently drops the earlier call's completion write. If this
 * limitation actually bites, use two separate `<wcs-credential>` instances
 * (one for get, one for store) rather than reworking the Core.
 */
declare class CredentialCore extends EventTarget {
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
    get value(): Credential | null;
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
    private _normalizeError;
    private _isCancellation;
    /**
     * `get(options)` — v1 scope excludes `publicKey` (WebAuthn). If present, it
     * is stripped and the call surfaces a scope-violation `error` instead of
     * forwarding it to the platform API (which would accidentally support
     * WebAuthn through a side door). `navigator.credentials.get()` does not
     * require a user gesture (unlike Web Share/Fullscreen), so this can be
     * invoked automatically on page load for a "silent sign-in" flow.
     */
    get(options?: CredentialGetOptions & {
        publicKey?: unknown;
    }): Promise<Credential | null>;
    /**
     * `store(credential)` — shares the same single `_gen` as `get()` (see class
     * docs). `navigator.credentials.store()` resolves `Promise<void>` (per
     * `lib.dom.d.ts`) — there is no payload to read off the API, so `value` is
     * synthesized as an echo of the caller's `credential`, mirroring
     * `ShareCore.share()`'s same accommodation for `navigator.share()`.
     *
     * A `PublicKeyCredential` (`type === "public-key"`, WebAuthn) is rejected as a
     * scope violation before touching the platform API — the same v1 boundary
     * `get()` enforces on the `publicKey` option (docs/credential-tag-design.md
     * §3.2), so this node never becomes a WebAuthn store backdoor.
     */
    store(credential: StorableCredential): Promise<Credential | null>;
}

/**
 * `<wcs-credential>` — declarative Credential Management API primitive
 * (password/federated only — see docs/credential-tag-design.md §0 for the
 * WebAuthn scope exclusion).
 *
 * A thin command-only Shell (mirrors `<wcs-share>`): no attributes at all.
 * `get(options)`/`store(credential)`'s arguments are per-call.
 */
declare class WcsCredential extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    constructor();
    get value(): Credential | null;
    get loading(): boolean;
    get error(): any;
    get cancelled(): boolean;
    get connectedCallbackPromise(): Promise<void>;
    get(options?: CredentialGetOptions): Promise<Credential | null>;
    store(credential: StorableCredential): Promise<Credential | null>;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { CredentialCore, WcsCredential, bootstrapCredential, getConfig };
export type { CredentialGetOptions, IWritableConfig, IWritableTagNames, StorableCredential, WcsCredentialCoreValues, WcsCredentialValues };
