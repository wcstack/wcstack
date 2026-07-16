/** operation error の phase(taxonomy)。 */
type WcsIoErrorPhase = "probe" | "start" | "execute" | "decode" | "commit" | "dispose";
/** serializable な error info(non-cloneable な cause とは分離。DevTools / remote へは info のみ)。 */
interface WcsIoErrorInfo {
    readonly code: string;
    readonly phase: WcsIoErrorPhase;
    readonly recoverable: boolean;
    readonly capabilityId?: string;
    readonly message: string;
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
    /** Integer protocol version. All versions >= 1 are core-compatible. */
    readonly version: number;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly notify: string;
}
interface IWritableTagNames {
    notify?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
    readonly autoTrigger: boolean;
    readonly triggerAttribute: string;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
    autoTrigger?: boolean;
    triggerAttribute?: string;
}

/**
 * Permission state mirroring the Permissions API `PermissionState`
 * (`"prompt"` / `"granted"` / `"denied"`) plus `"unsupported"` for environments
 * without the Notifications API. The Notifications API's own value `"default"` is
 * normalized to `"prompt"` so this node shares the exact four-value surface used by
 * `@wcstack/permission` / `@wcstack/geolocation` / `@wcstack/clipboard` — a binding
 * like `hidden@granted` works the same across all of them.
 */
type PermissionStateOrUnsupported = "prompt" | "granted" | "denied" | "unsupported";
/** Raw value returned by `Notification.permission` / `Notification.requestPermission()`. */
type NotificationPermissionRaw = "default" | "granted" | "denied";
/**
 * Which API actually shows the notification.
 * - `"constructor"` — `new Notification(title, options)` (desktop only).
 * - `"sw"` — `ServiceWorkerRegistration.showNotification()` (required on mobile/Android Chrome).
 * - `"auto"` — always try the `Notification` constructor first (no registration
 *   pre-check), and fall back to the SW backend only if the constructor throws a
 *   `TypeError` (e.g. on mobile, where `new Notification()` is illegal).
 */
type NotifyBackend = "auto" | "sw" | "constructor";
/**
 * Per-notification options forwarded to `new Notification(title, options)` or
 * `registration.showNotification(title, options)`. Mirrors the standard
 * `NotificationOptions`; `data` is round-tripped back to the click event payload.
 */
interface NotifyOptions {
    body?: string;
    icon?: string;
    badge?: string;
    image?: string;
    tag?: string;
    data?: unknown;
    lang?: string;
    dir?: "auto" | "ltr" | "rtl";
    requireInteraction?: boolean;
    silent?: boolean;
    renotify?: boolean;
}
/** Detail of the `wcs-notify:error` event. */
interface WcsNotifyErrorDetail {
    error: string;
    message: string;
}
/**
 * Detail of the `wcs-notify:click` / `:close` / `:show` events. `tag` identifies
 * the notification (a caller-supplied `options.tag`, or a Core-assigned `wcs-<n>`
 * id when omitted). `data` is whatever was passed in `options.data`. `action` is
 * the Service Worker action-button id (always `""` for the constructor backend).
 */
interface WcsNotifyClickDetail {
    tag: string;
    data: unknown;
    action: string;
}
/** Message posted from the Service Worker helper (`wireNotificationClicks`) to the page. */
interface WcsNotifySwMessage {
    __wcsNotify: true;
    id: string;
    tag: string;
    data: unknown;
    action: string;
}
/**
 * Value types for NotificationCore (headless) — the observable state properties.
 * Use with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 */
interface WcsNotifyCoreValues {
    permission: PermissionStateOrUnsupported;
    granted: boolean;
    denied: boolean;
    prompt: boolean;
    unsupported: boolean;
    error: WcsNotifyErrorDetail | null;
    /** Additive failure taxonomy derived from `error` (stable code / phase / recoverable). */
    errorInfo: WcsIoErrorInfo | null;
    clicked: WcsNotifyClickDetail | null;
    closed: WcsNotifyClickDetail | null;
    shown: WcsNotifyClickDetail | null;
}
/** Command surface for NotificationCore (headless). */
interface WcsNotifyCoreCommands {
    request(): Promise<PermissionStateOrUnsupported>;
    notify(title: string, options?: NotifyOptions): string;
    close(tag?: string): void;
    closeAll(): void;
}
/** Value types for the Shell (`<wcs-notify>`) — identical observable surface to the Core. */
type WcsNotifyValues = WcsNotifyCoreValues;
/** Command surface for the Shell (`<wcs-notify>`) — identical to the Core. */
type WcsNotifyCommands = WcsNotifyCoreCommands;
/**
 * Settable input surface for the Shell (`<wcs-notify>`). `notice` is the reactive
 * command-property (writing a *changed* value shows a notification); the rest are
 * declarative options mirrored as HTML attributes.
 */
interface WcsNotifyInputs {
    notice: string;
    mode: NotifyBackend;
    body: string;
    icon: string;
    badge: string;
    tag: string;
    lang: string;
    dir: string;
    requireInteraction: boolean;
    silent: boolean;
    renotify: boolean;
    manual: boolean;
}

declare function bootstrapNotification(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless desktop-notification primitive. A thin, framework-agnostic wrapper
 * around the Notifications API exposed through the wc-bindable protocol.
 *
 * Unlike `@wcstack/permission` (a read-only monitor — the Permissions API has no
 * `request()`), the Notifications API *does* expose `Notification.requestPermission()`,
 * so this node is self-contained: it both **requests/monitors** the permission and
 * **shows** notifications. It is the first @wcstack node where the command-token
 * (show: `notify`) and event-token (`click` / `close` / `show`) directions both
 * live in one tag.
 *
 * - **request()** asks for the `notifications` permission (`Notification.requestPermission`).
 * - **notify(title, options)** shows a notification and returns its identifying tag
 *   (a caller `options.tag`, or a generated `wcs-<n>`). It picks a backend per
 *   `mode`: the `Notification` constructor (desktop) or
 *   `ServiceWorkerRegistration.showNotification()` (mobile). `"auto"` prefers the
 *   constructor and falls back to the SW on a `TypeError`.
 * - **close(tag) / closeAll()** dismiss notifications by tag / all.
 * - Clicks flow back as the `wcs-notify:click` event: directly via the
 *   Notification's `onclick` (constructor), or via the SW helper's
 *   BroadcastChannel/postMessage relay (SW). `permission` mirrors the live grant.
 *
 * Failures never throw: they surface through `error` (and the `unsupported`
 * permission state) so they flow into the declarative state.
 */
declare class NotificationCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _mode;
    private _permission;
    private _error;
    private _errorInfo;
    private _lastClick;
    private _lastClose;
    private _lastShow;
    private _permissionStatus;
    private _permissionSubscribed;
    private _gen;
    private _ready;
    private _idSeq;
    private _constructed;
    private _swTags;
    private _channel;
    private _serviceWorker;
    private _clicksSubscribed;
    private _seenIds;
    constructor(target?: EventTarget);
    get permission(): PermissionStateOrUnsupported;
    get granted(): boolean;
    get denied(): boolean;
    get prompt(): boolean;
    get unsupported(): boolean;
    get error(): WcsNotifyErrorDetail | null;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-notify:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    get clicked(): WcsNotifyClickDetail | null;
    get closed(): WcsNotifyClickDetail | null;
    get shown(): WcsNotifyClickDetail | null;
    /** Resolves once the current (or initial) permission probe settles. */
    get ready(): Promise<void>;
    private _setPermission;
    private _setError;
    private _commitErrorInfo;
    private _emit;
    /**
     * Start observing the `notifications` permission and subscribing to Service
     * Worker click relays. `mode` selects the show backend (default `"auto"`).
     * Idempotent while already subscribed: it only updates the stored mode; to
     * restart, dispose() first. Returns a promise that resolves once the first
     * permission probe settles, for SSR.
     *
     * Headless callers must call observe() to begin; the Shell calls it from
     * connectedCallback once the element's attributes resolve.
     */
    observe(mode?: NotifyBackend): Promise<void>;
    /**
     * Ask the user for the `notifications` permission. Resolves to the resulting
     * (normalized) permission state. Never throws: an unavailable API resolves to
     * `"unsupported"`.
     */
    request(): Promise<PermissionStateOrUnsupported>;
    /**
     * Show a notification. Returns the identifying tag (the caller's `options.tag`,
     * or a generated `wcs-<n>` when omitted). Never throws: when the API is
     * unavailable or the permission is not granted it surfaces an `error` and
     * returns an empty string.
     */
    notify(title: string, options?: NotifyOptions): string;
    /** Dismiss the notification(s) with `tag` across both backends. */
    close(tag?: string): void;
    /**
     * Dismiss every notification this instance has shown. Scoped to this instance's
     * own tags on both backends — the SW path closes each tracked tag individually
     * rather than enumerating the whole origin, so it never dismisses notifications
     * shown by another `<wcs-notify>` or by an unrelated code path.
     */
    closeAll(): void;
    /**
     * Detach permission and click subscriptions. Open notifications are intentionally
     * **left on screen** (a notification outlives the page that posted it — that is
     * the point); use close()/closeAll() to dismiss. Call from the Shell's
     * disconnectedCallback. A later observe() resumes.
     */
    dispose(): void;
    private _initPermission;
    private _onPermissionChange;
    private _normalize;
    private _show;
    private _showViaConstructor;
    private _showViaSw;
    private _closeSw;
    private _subscribeClicks;
    private _onInbound;
    private _isDuplicate;
    private _unwrap;
    private _api;
    private _nextId;
    private _err;
}

/**
 * `<wcs-notify>` — declarative desktop notifications. Wraps NotificationCore and
 * exposes both directions in one tag:
 *
 * - **`notice`** (reactive input): writing a *changed* value shows a notification,
 *   suppressing same-value writes so it fires only when the bound source actually
 *   changes. The imperative `notify` command instead shows on demand (even the
 *   same text again). See `docs/notification-tag-design.md` § 2.
 * - **`request` / `notify` / `close` / `closeAll`** commands (state → element).
 * - per-notification options (`body` / `icon` / `badge` / `tag` / `lang` / `dir` /
 *   `require-interaction` / `silent` / `renotify`) as mirrored attributes.
 * - `mode` selects the show backend (`auto` / `sw` / `constructor`).
 * - the Core's observable surface (permission / granted / … / error / clicked /
 *   closed / shown) via delegated getters; clicked/closed/shown carry the
 *   `{ tag, data, action }` payload for event-token wiring.
 */
declare class WcsNotify extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _notice;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get mode(): NotifyBackend;
    set mode(value: NotifyBackend);
    get body(): string;
    set body(value: string | null);
    get icon(): string;
    set icon(value: string | null);
    get badge(): string;
    set badge(value: string | null);
    get tag(): string;
    set tag(value: string | null);
    get lang(): string;
    set lang(value: string | null);
    get dir(): string;
    set dir(value: string | null);
    get requireInteraction(): boolean;
    set requireInteraction(value: boolean);
    get silent(): boolean;
    set silent(value: boolean);
    get renotify(): boolean;
    set renotify(value: boolean);
    get manual(): boolean;
    set manual(value: boolean);
    get notice(): string;
    set notice(value: string | null);
    get permission(): PermissionStateOrUnsupported;
    get granted(): boolean;
    get denied(): boolean;
    get prompt(): boolean;
    get unsupported(): boolean;
    get error(): WcsNotifyErrorDetail | null;
    get errorInfo(): WcsIoErrorInfo | null;
    get clicked(): WcsNotifyClickDetail | null;
    get closed(): WcsNotifyClickDetail | null;
    get shown(): WcsNotifyClickDetail | null;
    get connectedCallbackPromise(): Promise<void>;
    request(): Promise<PermissionStateOrUnsupported>;
    notify(title: string, options?: NotifyOptions): string;
    close(tag?: string): void;
    closeAll(): void;
    private _reflect;
    private _reflectBool;
    private _options;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * notificationCapabilities.ts
 *
 * Notification node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。notification は監視(permission)と操作(notify/close)を 1 タグに併せ持つが、
 * 競合する非同期 operation の lane は持たない(show は最新値で上書きされる momentary な
 * 送出)ため、lane は採用せず error taxonomy(errorInfo)のみを追加する。
 *
 * sensor family と異なり、NotificationCore の error detail の `.error` は既に安定コード
 * (`this._err(code, message)` が産出する `"unsupported"` / `"not-granted"` /
 * `"invalid-title"` / `"show-failed"` / `"no-service-worker"`)であり、Error.name ではない。
 * したがって derivation は `.error` コードを taxonomy に写すだけの純粋な map である。
 * 想定外のコードは防御的に `notify-error` へ畳む。
 */

/** 安定した notification error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_NOTIFY_ERROR_CODE: {
    /** Notifications API 非対応(`globalThis.Notification` 不在)。 */
    readonly CapabilityMissing: "capability-missing";
    /** 権限が granted でない状態での notify()。 */
    readonly NotAllowed: "not-allowed";
    /** notify() に非文字列 title が渡された。 */
    readonly InvalidArgument: "invalid-argument";
    /** notification の生成 / 表示に失敗した(constructor 例外 / onerror / SW show reject)。 */
    readonly ShowFailed: "show-failed";
    /** SW backend が必要だが `navigator.serviceWorker` が不在。 */
    readonly NoServiceWorker: "no-service-worker";
    /** その他 / 想定外の error code に対する防御的 fallback。 */
    readonly NotifyError: "notify-error";
};

export { NotificationCore, WCS_NOTIFY_ERROR_CODE, WcsNotify, bootstrapNotification, getConfig };
export type { IWritableConfig, IWritableTagNames, NotificationPermissionRaw, NotifyBackend, NotifyOptions, PermissionStateOrUnsupported, WcsIoErrorInfo, WcsIoErrorPhase, WcsNotifyClickDetail, WcsNotifyCommands, WcsNotifyCoreCommands, WcsNotifyCoreValues, WcsNotifyErrorDetail, WcsNotifyInputs, WcsNotifySwMessage, WcsNotifyValues };
