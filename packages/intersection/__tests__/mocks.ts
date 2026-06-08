// Controllable IntersectionObserver fake.
//
// The real IntersectionObserver delivers entries asynchronously off layout, which
// happy-dom cannot drive. These helpers replace globalThis.IntersectionObserver
// with a fake whose entries are pushed manually via the returned controller,
// mirroring the geolocation package's navigator.geolocation mock.

export interface FakeRectInit {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface FakeEntryInit {
  isIntersecting?: boolean;
  intersectionRatio?: number;
  time?: number;
  target?: Element;
  boundingClientRect?: FakeRectInit;
  intersectionRect?: FakeRectInit;
  rootBounds?: FakeRectInit | null;
}

function makeRect(init: FakeRectInit = {}): DOMRectReadOnly {
  return {
    x: init.x ?? 0,
    y: init.y ?? 0,
    width: init.width ?? 0,
    height: init.height ?? 0,
    top: init.top ?? 0,
    right: init.right ?? 0,
    bottom: init.bottom ?? 0,
    left: init.left ?? 0,
    toJSON() { return this; },
  } as DOMRectReadOnly;
}

/** Build an IntersectionObserverEntry-like object from a partial init. */
export function makeEntry(init: FakeEntryInit = {}): IntersectionObserverEntry {
  return {
    isIntersecting: init.isIntersecting ?? false,
    intersectionRatio: init.intersectionRatio ?? (init.isIntersecting ? 1 : 0),
    time: init.time ?? 0,
    target: init.target ?? document.createElement("div"),
    boundingClientRect: makeRect(init.boundingClientRect),
    intersectionRect: makeRect(init.intersectionRect),
    rootBounds: init.rootBounds === null ? null : makeRect(init.rootBounds ?? {}),
  } as IntersectionObserverEntry;
}

export class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.options = options;
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  // No unobserve() stub: the single-target Core only ever tears down via
  // disconnect() (it rebuilds the observer to reconfigure), so the native
  // unobserve() is never exercised — modeling it here would be dead scaffolding.

  disconnect(): void {
    this.disconnected = true;
    this.observed = [];
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Deliver entries to the stored callback, as the browser would. */
  emit(entries: IntersectionObserverEntry[]): void {
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

export interface IntersectionObserverController {
  instances: FakeIntersectionObserver[];
  readonly last: FakeIntersectionObserver;
  /** Emit a single entry (defaulting target to the last observed element) to the latest observer. */
  emit(init?: FakeEntryInit): void;
}

/**
 * Install a controllable IntersectionObserver fake on globalThis. Pass
 * `throwOnConstruct: true` to simulate the constructor rejecting invalid options
 * (e.g. a malformed rootMargin).
 */
export function installIntersectionObserver(opts: { throwOnConstruct?: boolean } = {}): IntersectionObserverController {
  const instances: FakeIntersectionObserver[] = [];

  class IO extends FakeIntersectionObserver {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
      if (opts.throwOnConstruct) {
        throw new SyntaxError("invalid rootMargin");
      }
      super(callback, options);
      instances.push(this);
    }
  }

  (globalThis as any).IntersectionObserver = IO;

  const controller: IntersectionObserverController = {
    instances,
    get last() {
      return instances[instances.length - 1];
    },
    emit(init: FakeEntryInit = {}) {
      const obs = instances[instances.length - 1];
      const target = init.target ?? obs.observed[obs.observed.length - 1];
      obs.emit([makeEntry({ ...init, target })]);
    },
  };

  return controller;
}

/** Remove IntersectionObserver so the "unsupported" branch can be tested. */
export function removeIntersectionObserver(): void {
  (globalThis as any).IntersectionObserver = undefined;
}
