interface ITagNames {
    readonly clipboard: string;
}
interface IWritableTagNames {
    clipboard?: string;
}
interface IConfig {
    readonly autoTrigger: boolean;
    readonly triggerAttribute: string;
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    autoTrigger?: boolean;
    triggerAttribute?: string;
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
 * Permission state for the Clipboard API, mirroring the Permissions API
 * `PermissionState` plus `"unsupported"` for environments without
 * `navigator.permissions` (or where the `clipboard-read` / `clipboard-write`
 * permissions cannot be queried — e.g. Firefox, which does not expose them).
 */
type ClipboardPermissionState = "prompt" | "granted" | "denied" | "unsupported";
/**
 * Normalized snapshot of a single `ClipboardItem` read via `read()`. Unlike the
 * live `ClipboardItem` (whose `getType()` returns a fresh promise each call),
 * every representation is eagerly resolved to a `Blob` so the data can flow
 * through declarative binding without further async work.
 */
interface WcsClipboardReadItem {
    /** MIME types present in this item (e.g. `["text/plain", "text/html"]`). */
    types: string[];
    /** Resolved blobs keyed by MIME type. */
    data: Record<string, Blob>;
}
/**
 * Payload carried by the `wcs-clipboard:read` event — the result of a
 * `readText()` or `read()` call.
 *
 * - `text` is the `text/plain` content when available (always set by
 *   `readText()`, and extracted from a `text/plain` representation by `read()`),
 *   otherwise `null`.
 * - `items` is the structured snapshot from a rich `read()`, or `null` for a
 *   plain `readText()`.
 */
interface WcsClipboardReadDetail {
    text: string | null;
    items: WcsClipboardReadItem[] | null;
}
/**
 * Normalized Clipboard API failure. `name` mirrors the `DOMException.name`
 * (e.g. `NotAllowedError`, `NotFoundError`); `unsupported` is surfaced as
 * `NotSupportedError` when `navigator.clipboard` is absent (non-secure context
 * or unsupported browser).
 */
interface WcsClipboardErrorDetail {
    name: string;
    message: string;
}
/**
 * Value types for ClipboardCore (headless) — the observable state properties.
 * Use with `bind()` from `@wc-bindable/core` for compile-time type checking.
 *
 * @example
 * ```typescript
 * const core = new ClipboardCore();
 * bind(core, (name: keyof WcsClipboardCoreValues, value) => { ... });
 * ```
 */
interface WcsClipboardCoreValues {
    text: string | null;
    items: WcsClipboardReadItem[] | null;
    loading: boolean;
    error: WcsClipboardErrorDetail | null;
    readPermission: ClipboardPermissionState;
    writePermission: ClipboardPermissionState;
    monitoring: boolean;
    copied: string | null;
    cut: string | null;
    pasted: string | null;
}
/**
 * Value types for the Shell (`<wcs-clipboard>`) — identical observable surface
 * to the Core.
 */
type WcsClipboardValues = WcsClipboardCoreValues;
interface WcsClipboardInputs {
    /**
     * When present, start monitoring document `copy` / `cut` / `paste` events on
     * connect, publishing them as the `copied` / `cut` / `pasted` properties.
     */
    monitor: boolean;
}
interface WcsClipboardCoreCommands {
    writeText(text: string): Promise<void>;
    write(items: ClipboardItem[]): Promise<void>;
    readText(): Promise<void>;
    read(): Promise<void>;
    startMonitor(): void;
    stopMonitor(): void;
}
/** Commands exposed on the Shell — identical surface to the Core. */
type WcsClipboardCommands = WcsClipboardCoreCommands;

declare function bootstrapClipboard(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless clipboard primitive. A thin, framework-agnostic wrapper around the
 * Clipboard API exposed through the wc-bindable protocol.
 *
 * It has two surfaces, mirroring the two distinct shapes of clipboard access:
 * - **commands** — `writeText()` / `write()` push to the clipboard;
 *   `readText()` / `read()` pull from it. These are the `state → element`
 *   (command-token) and `element → state` (read result) paths. All four are
 *   async and never reject: failures surface through the `error` property so
 *   they flow into the declarative state, symmetrical with FetchCore /
 *   GeolocationCore.
 * - **monitor** — `startMonitor()` / `stopMonitor()` subscribe to the document's
 *   `copy` / `cut` / `paste` events and republish them as the `copied` / `cut` /
 *   `pasted` properties (like TimerCore's continuous `start()` / `stop()`),
 *   toggling the `monitoring` flag. This is the event-token showcase: a user
 *   paste flows element → state declaratively.
 *
 * Clipboard also has permission gates, like GeolocationCore but doubled: read
 * and write are separate permissions (`clipboard-read` / `clipboard-write`).
 * `readPermission` / `writePermission` reflect `navigator.permissions.query`
 * (`prompt` / `granted` / `denied`, or `unsupported`) and track their live
 * `change` events.
 */
declare class ClipboardCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _text;
    private _items;
    private _loading;
    private _error;
    private _readPermission;
    private _writePermission;
    private _monitoring;
    private _copied;
    private _cut;
    private _pasted;
    private _readStatus;
    private _writeStatus;
    private _permissionSubscribed;
    private _permGen;
    private _acqGen;
    constructor(target?: EventTarget);
    get text(): string | null;
    get items(): WcsClipboardReadItem[] | null;
    get loading(): boolean;
    get error(): WcsClipboardErrorDetail | null;
    get readPermission(): ClipboardPermissionState;
    get writePermission(): ClipboardPermissionState;
    get monitoring(): boolean;
    get copied(): string | null;
    get cut(): string | null;
    get pasted(): string | null;
    private _setRead;
    private _setLoading;
    private _setError;
    private _setReadPermission;
    private _setWritePermission;
    private _setMonitoring;
    private _setCopied;
    private _setCut;
    private _setPasted;
    /**
     * Write plain text to the clipboard. Resolves once the write settles or fails
     * — never rejects: failures surface through `error`. Requires transient
     * activation (a user gesture), so call from a click handler / command-token.
     */
    writeText(text: string): Promise<void>;
    /**
     * Write rich `ClipboardItem`s (images, HTML, multiple MIME types) to the
     * clipboard. Resolves once the write settles or fails — never rejects.
     */
    write(items: ClipboardItem[]): Promise<void>;
    /**
     * Read plain text from the clipboard, publishing it via `text` and the
     * `wcs-clipboard:read` event. Resolves once the read settles or fails — never
     * rejects. Requires focus + read permission.
     */
    readText(): Promise<void>;
    /**
     * Read rich `ClipboardItem`s from the clipboard, eagerly resolving every
     * representation to a `Blob`. A `text/plain` representation is also surfaced
     * via `text`. Resolves once the read settles or fails — never rejects.
     */
    read(): Promise<void>;
    /**
     * Begin monitoring document `copy` / `cut` / `paste` events, republishing
     * them as the `copied` / `cut` / `pasted` properties. Idempotent while already
     * monitoring (mirrors GeolocationCore.watch()).
     */
    startMonitor(): void;
    stopMonitor(): void;
    /**
     * Re-establish the permission `change` subscriptions after a dispose() — e.g.
     * the Shell element was disconnected and then reconnected (reparented). No-op
     * while a subscription is already live, so the first connect after
     * construction does not double-subscribe.
     */
    reinitPermission(): void;
    /**
     * Detach the live permission `change` listeners and any monitor listeners, and
     * neutralize in-flight async ops. Call from the Shell's `disconnectedCallback`
     * so a removed element does not leak subscriptions or dispatch on a torn-down
     * element. A later reconnect can re-subscribe via reinitPermission().
     */
    dispose(): void;
    private _runWrite;
    private _runRead;
    /**
     * Shared async-op lifecycle for read/write: capability check, loading toggle,
     * generation guard, never-reject error handling. When `op` returns a read
     * detail it is published; when it returns null (a write) nothing is published.
     */
    private _runOp;
    private _onCopy;
    private _onCut;
    private _onPaste;
    private _removeMonitorListeners;
    private _selectionText;
    private _initPermissions;
    private _queryPermission;
    private _onReadChange;
    private _onWriteChange;
    private _hasClipboard;
    private _normalizeItems;
    private _normalizeError;
    private _unsupportedError;
}

declare class WcsClipboard extends HTMLElement {
    static wcBindable: IWcBindable;
    private _core;
    constructor();
    get monitor(): boolean;
    /**
     * Reflects the `monitor` boolean attribute only — it does NOT start or stop
     * monitoring by itself. The attribute is read at connect time (see
     * connectedCallback); toggling `el.monitor` after connect just flips the
     * attribute. To start/stop monitoring imperatively, call `startMonitor()` /
     * `stopMonitor()`.
     */
    set monitor(value: boolean);
    get text(): string | null;
    get items(): WcsClipboardReadItem[] | null;
    get loading(): boolean;
    get error(): WcsClipboardErrorDetail | null;
    get readPermission(): ClipboardPermissionState;
    get writePermission(): ClipboardPermissionState;
    get monitoring(): boolean;
    get copied(): string | null;
    get cut(): string | null;
    get pasted(): string | null;
    writeText(text: string): Promise<void>;
    write(items: ClipboardItem[]): Promise<void>;
    readText(): Promise<void>;
    read(): Promise<void>;
    startMonitor(): void;
    stopMonitor(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { ClipboardCore, WcsClipboard, bootstrapClipboard, getConfig };
export type { ClipboardPermissionState, IWritableConfig, IWritableTagNames, WcsClipboardCommands, WcsClipboardCoreCommands, WcsClipboardCoreValues, WcsClipboardErrorDetail, WcsClipboardInputs, WcsClipboardReadDetail, WcsClipboardReadItem, WcsClipboardValues };
