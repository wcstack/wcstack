import { vi } from "vitest";

// --- Notifications API (globalThis.Notification) ---------------------------

/**
 * Controllable fake of the `Notification` constructor. Instances record their
 * title/options and expose `fireShow` / `fireClick` / `fireError` / `fireClose`
 * so a test can simulate the browser firing the corresponding callback.
 */
export class FakeNotification {
  static permission = "granted";
  static requestResult = "granted";
  static rejectRequest = false;
  /** When set, the constructor throws this value (e.g. a TypeError on mobile). */
  static throwOnConstruct: unknown = null;
  static instances: FakeNotification[] = [];

  title: string;
  options: any;
  tag: string | undefined;
  data: unknown;
  closed = false;
  onclick: ((ev: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  onshow: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(title: string, options: any = {}) {
    if (FakeNotification.throwOnConstruct) throw FakeNotification.throwOnConstruct;
    this.title = title;
    this.options = options;
    this.tag = options.tag;
    this.data = options.data;
    FakeNotification.instances.push(this);
  }

  static requestPermission(): Promise<string> {
    if (FakeNotification.rejectRequest) return Promise.reject(new Error("request rejected"));
    return Promise.resolve(FakeNotification.requestResult);
  }

  // The real .close() does not fire onclose synchronously here; we keep it
  // explicit (fireClose) so close()/closeAll() tests don't get surprise emits.
  close(): void {
    this.closed = true;
  }

  fireShow(): void { this.onshow?.(); }
  fireClick(): void { this.onclick?.(new Event("click")); }
  fireError(): void { this.onerror?.(); }
  fireClose(): void { this.onclose?.(); }
}

export function installNotification(opts: { permission?: string } = {}): typeof FakeNotification {
  FakeNotification.permission = opts.permission ?? "granted";
  FakeNotification.requestResult = "granted";
  FakeNotification.rejectRequest = false;
  FakeNotification.throwOnConstruct = null;
  FakeNotification.instances = [];
  Object.defineProperty(globalThis, "Notification", {
    value: FakeNotification,
    configurable: true,
    writable: true,
  });
  return FakeNotification;
}

export function removeNotification(): void {
  Object.defineProperty(globalThis, "Notification", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

// --- Service Worker --------------------------------------------------------

export interface ServiceWorkerMock extends EventTarget {
  ready: Promise<any>;
  registration: { showNotification: ReturnType<typeof vi.fn>; getNotifications: ReturnType<typeof vi.fn> };
  /** Simulate the SW posting a message back to the page. */
  dispatchMessage: (data: unknown) => void;
}

export interface SwTracked { tag?: string; close: ReturnType<typeof vi.fn> }

export function installServiceWorker(opts: { readyReject?: boolean; showReject?: boolean; getReject?: boolean } = {}): {
  sw: ServiceWorkerMock;
  showNotification: ReturnType<typeof vi.fn>;
  getNotifications: ReturnType<typeof vi.fn>;
  notifications: SwTracked[];
} {
  const notifications: SwTracked[] = [];
  const showNotification = vi.fn((_title: string, options: any = {}) => {
    if (opts.showReject) return Promise.reject(new Error("show failed"));
    notifications.push({ tag: options.tag, close: vi.fn() });
    return Promise.resolve();
  });
  const getNotifications = vi.fn((q?: { tag?: string }) => {
    if (opts.getReject) return Promise.reject(new Error("getNotifications failed"));
    return Promise.resolve(q && q.tag ? notifications.filter((n) => n.tag === q.tag) : notifications.slice());
  });
  const registration = { showNotification, getNotifications };
  const ready = opts.readyReject
    ? Promise.reject(new Error("no service worker"))
    : Promise.resolve(registration);
  // Swallow the rejection for the readyReject case so it is not reported as an
  // unhandled rejection before the Core attaches its handler.
  ready.catch(() => {});

  const sw = new EventTarget() as ServiceWorkerMock;
  sw.ready = ready;
  sw.registration = registration;
  sw.dispatchMessage = (data: unknown) => {
    sw.dispatchEvent(new MessageEvent("message", { data }));
  };

  Object.defineProperty(navigator, "serviceWorker", {
    value: sw,
    configurable: true,
    writable: true,
  });
  return { sw, showNotification, getNotifications, notifications };
}

export function removeServiceWorker(): void {
  Object.defineProperty(navigator, "serviceWorker", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

// --- BroadcastChannel ------------------------------------------------------

// Deterministic, synchronous BroadcastChannel fake. happy-dom's real
// BroadcastChannel delivers across instances on an unreliable timer, which makes
// the relay path flaky; this fake delivers a postMessage() to every other open
// instance of the same name synchronously.
export class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  name: string;
  closed = false;
  private _listeners: ((e: MessageEvent) => void)[] = [];

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void): void {
    if (type === "message") this._listeners.push(fn);
  }

  removeEventListener(type: string, fn: (e: MessageEvent) => void): void {
    if (type === "message") this._listeners = this._listeners.filter((l) => l !== fn);
  }

  postMessage(data: unknown): void {
    for (const inst of FakeBroadcastChannel.instances) {
      if (inst !== this && inst.name === this.name && !inst.closed) {
        inst._deliver(data);
      }
    }
  }

  close(): void {
    this.closed = true;
  }

  private _deliver(data: unknown): void {
    for (const l of this._listeners) l(new MessageEvent("message", { data }));
  }
}

let _realBroadcastChannel: any;

export function installBroadcastChannel(): typeof FakeBroadcastChannel {
  _realBroadcastChannel = (globalThis as any).BroadcastChannel;
  FakeBroadcastChannel.instances = [];
  (globalThis as any).BroadcastChannel = FakeBroadcastChannel;
  return FakeBroadcastChannel;
}

export function removeBroadcastChannel(): void {
  (globalThis as any).BroadcastChannel = _realBroadcastChannel;
}

// --- Permissions API -------------------------------------------------------

export interface PermissionStatusMock extends EventTarget {
  state: string;
  change: (state: string) => void;
}

export function makePermissionStatus(state = "prompt"): PermissionStatusMock {
  const status = new EventTarget() as PermissionStatusMock;
  status.state = state;
  status.change = (next: string) => {
    status.state = next;
    status.dispatchEvent(new Event("change"));
  };
  return status;
}

export function installPermissions(opts: { state?: string; reject?: boolean } = {}): {
  query: ReturnType<typeof vi.fn>;
  statuses: PermissionStatusMock[];
  descriptors: any[];
} {
  const statuses: PermissionStatusMock[] = [];
  const descriptors: any[] = [];
  const query = opts.reject
    ? vi.fn((descriptor: any) => {
        descriptors.push(descriptor);
        return Promise.reject(new TypeError("unsupported permission name"));
      })
    : vi.fn((descriptor: any) => {
        descriptors.push(descriptor);
        const s = makePermissionStatus(opts.state ?? "prompt");
        statuses.push(s);
        return Promise.resolve(s);
      });
  Object.defineProperty(navigator, "permissions", {
    value: { query },
    configurable: true,
    writable: true,
  });
  return { query, statuses, descriptors };
}

export function removePermissions(): void {
  Object.defineProperty(navigator, "permissions", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/** Flush pending microtasks so multi-level promise chains (ready→show→catch) run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** Flush a macrotask (BroadcastChannel delivery in happy-dom is async). */
export function flushMacro(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
