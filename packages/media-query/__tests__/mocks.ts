import type { WcsMatchMedia, WcsMediaQueryList } from "../src/types";

/**
 * Which listener surface the fake MediaQueryList exposes:
 *   modern  — addEventListener / removeEventListener (every current engine)
 *   legacy  — addListener / removeListener only (Safari < 14)
 *   static  — neither (a polyfill that only answers `matches`)
 *   mixed   — addEventListener but NO removeEventListener, plus the legacy
 *             pair: the Core must not pick a half-implemented modern surface
 */
export type ListenerSurface = "modern" | "legacy" | "static" | "mixed";

export interface FakeListOptions {
  matches?: boolean;
  media?: string;
  surface?: ListenerSurface;
  /** removeEventListener / removeListener is a no-op — the list keeps firing. */
  leaky?: boolean;
  /** removeEventListener / removeListener throws. */
  throwOnRemove?: boolean;
}

/** Controllable MediaQueryList double. Tests flip `matches` and fire `change` directly. */
export class FakeMediaQueryList implements WcsMediaQueryList {
  matches: boolean;
  media: string;
  readonly listeners = new Set<() => void>();
  private readonly _leaky: boolean;
  private readonly _throwOnRemove: boolean;

  constructor(options: FakeListOptions = {}) {
    this.matches = options.matches ?? false;
    this.media = options.media ?? "";
    this._leaky = options.leaky ?? false;
    this._throwOnRemove = options.throwOnRemove ?? false;
    const surface = options.surface ?? "modern";
    if (surface === "modern" || surface === "mixed") {
      (this as any).addEventListener = (_type: "change", listener: () => void) => { this.listeners.add(listener); };
    }
    if (surface === "modern") {
      (this as any).removeEventListener = (_type: "change", listener: () => void) => { this._remove(listener); };
    }
    if (surface === "legacy" || surface === "mixed") {
      (this as any).addListener = (listener: () => void) => { this.listeners.add(listener); };
      (this as any).removeListener = (listener: () => void) => { this._remove(listener); };
    }
  }

  private _remove(listener: () => void): void {
    if (this._throwOnRemove) throw new Error("remove failed");
    if (this._leaky) return;
    this.listeners.delete(listener);
  }

  /** Fire `change` to every attached listener without touching `matches`. */
  fire(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Set `matches` and fire `change`, as the real list does. */
  setMatches(matches: boolean): void {
    this.matches = matches;
    this.fire();
  }
}

/**
 * A matchMedia double that hands out one FakeMediaQueryList per call and
 * records every query it was asked for. `lists` is in call order so a test can
 * reach the list behind any subscription (including a torn-down one).
 */
export class FakeMatchMedia {
  readonly queries: string[] = [];
  readonly lists: FakeMediaQueryList[] = [];
  private _nextOptions: FakeListOptions;
  private _throwNext = false;

  constructor(defaults: FakeListOptions = {}) {
    this._nextOptions = defaults;
  }

  /** Options applied to the list created by the next matchMedia call. */
  next(options: FakeListOptions): this {
    this._nextOptions = { ...this._nextOptions, ...options };
    return this;
  }

  /** Make the next matchMedia call throw (never-throw wrapper coverage). */
  throwNext(): this {
    this._throwNext = true;
    return this;
  }

  get last(): FakeMediaQueryList {
    return this.lists[this.lists.length - 1];
  }

  // Arrow property so the instance's matchMedia can be passed straight into
  // the MediaQueryCore constructor / installed on globalThis.
  matchMedia: WcsMatchMedia = (query: string) => {
    this.queries.push(query);
    if (this._throwNext) {
      this._throwNext = false;
      throw new TypeError("matchMedia exploded");
    }
    const list = new FakeMediaQueryList({ media: query, ...this._nextOptions });
    this.lists.push(list);
    return list;
  };
}

// --- globalThis.matchMedia install / remove (Shell tests) --------------------

const g = globalThis as { matchMedia?: unknown };
const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");

/** Install a FakeMatchMedia as globalThis.matchMedia. Returns the fake. */
export function installMatchMedia(defaults: FakeListOptions = {}): FakeMatchMedia {
  const fake = new FakeMatchMedia(defaults);
  Object.defineProperty(g, "matchMedia", { value: fake.matchMedia, configurable: true, writable: true });
  return fake;
}

/** Remove globalThis.matchMedia so the "unsupported" (SSR / worker) branch can be tested. */
export function removeMatchMedia(): void {
  Object.defineProperty(g, "matchMedia", { value: undefined, configurable: true, writable: true });
}

/** Put back whatever the environment (happy-dom) originally exposed. */
export function restoreMatchMedia(): void {
  if (originalDescriptor) {
    Object.defineProperty(g, "matchMedia", originalDescriptor);
  } else {
    delete g.matchMedia;
  }
}
