export interface ITagNames {
  readonly notify: string;
}

export interface IWritableTagNames {
  notify?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
  readonly autoTrigger: boolean;
  readonly triggerAttribute: string;
}

export interface IWritableConfig {
  tagNames?: IWritableTagNames;
  autoTrigger?: boolean;
  triggerAttribute?: string;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

/**
 * Permission state mirroring the Permissions API `PermissionState`
 * (`"prompt"` / `"granted"` / `"denied"`) plus `"unsupported"` for environments
 * without the Notifications API. The Notifications API's own value `"default"` is
 * normalized to `"prompt"` so this node shares the exact four-value surface used by
 * `@wcstack/permission` / `@wcstack/geolocation` / `@wcstack/clipboard` — a binding
 * like `hidden@granted` works the same across all of them.
 */
export type PermissionStateOrUnsupported = "prompt" | "granted" | "denied" | "unsupported";

/** Raw value returned by `Notification.permission` / `Notification.requestPermission()`. */
export type NotificationPermissionRaw = "default" | "granted" | "denied";

/**
 * Which API actually shows the notification.
 * - `"constructor"` — `new Notification(title, options)` (desktop only).
 * - `"sw"` — `ServiceWorkerRegistration.showNotification()` (required on mobile/Android Chrome).
 * - `"auto"` — pick SW when a registration is ready and `new Notification` is unusable,
 *   otherwise the constructor; fall back to SW if the constructor throws `TypeError`.
 */
export type NotifyBackend = "auto" | "sw" | "constructor";

/**
 * Per-notification options forwarded to `new Notification(title, options)` or
 * `registration.showNotification(title, options)`. Mirrors the standard
 * `NotificationOptions`; `data` is round-tripped back to the click event payload.
 */
export interface NotifyOptions {
  body?: string;
  icon?: string;
  badge?: string;
  // `image` is intentionally per-call only: it is NOT exposed as an HTML attribute
  // on `<wcs-notify>` (no accessor, not in WcsNotifyInputs, not built by `_options()`).
  // It is kept here so a `notify(title, { image })` command emit can still forward it
  // (NotificationCore spreads options straight to the backend). It is deliberately not
  // promoted to a declarative default because `NotificationOptions.image` was an
  // experimental, Chrome-only field that has since been dropped from the spec — adding
  // attribute machinery for a deprecated option would be over-implementation. The other
  // standard options below all have matching attributes.
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
export interface WcsNotifyErrorDetail {
  error: string;
  message: string;
}

/**
 * Detail of the `wcs-notify:click` / `:close` / `:show` events. `tag` identifies
 * the notification (a caller-supplied `options.tag`, or a Core-assigned `wcs-<n>`
 * id when omitted). `data` is whatever was passed in `options.data`. `action` is
 * the Service Worker action-button id (always `""` for the constructor backend).
 */
export interface WcsNotifyClickDetail {
  tag: string;
  data: unknown;
  action: string;
}

/** Message posted from the Service Worker helper (`wireNotificationClicks`) to the page. */
export interface WcsNotifySwMessage {
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
export interface WcsNotifyCoreValues {
  permission: PermissionStateOrUnsupported;
  granted: boolean;
  denied: boolean;
  prompt: boolean;
  unsupported: boolean;
  error: WcsNotifyErrorDetail | null;
  clicked: WcsNotifyClickDetail | null;
  closed: WcsNotifyClickDetail | null;
  shown: WcsNotifyClickDetail | null;
}

/** Command surface for NotificationCore (headless). */
export interface WcsNotifyCoreCommands {
  request(): Promise<PermissionStateOrUnsupported>;
  notify(title: string, options?: NotifyOptions): string;
  close(tag?: string): void;
  closeAll(): void;
}

/** Value types for the Shell (`<wcs-notify>`) — identical observable surface to the Core. */
export type WcsNotifyValues = WcsNotifyCoreValues;

/** Command surface for the Shell (`<wcs-notify>`) — identical to the Core. */
export type WcsNotifyCommands = WcsNotifyCoreCommands;

/**
 * Settable input surface for the Shell (`<wcs-notify>`). `notice` is the reactive
 * command-property (writing a *changed* value shows a notification); the rest are
 * declarative options mirrored as HTML attributes.
 */
export interface WcsNotifyInputs {
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
