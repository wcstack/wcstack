// Controllable ResizeObserver fake.
//
// The real ResizeObserver delivers entries asynchronously off layout, which
// happy-dom cannot drive. These helpers replace globalThis.ResizeObserver with a
// fake whose entries are pushed manually via the returned controller, mirroring the
// intersection package's IntersectionObserver mock.
//
// Unlike IntersectionObserver, the throw path is on observe() (an unsupported
// `box`), not the constructor — so the install helper takes `throwBoxes` to
// simulate a runtime rejecting specific box options (e.g. device-pixel-content-box
// on Safari). `"*"` throws for every box.

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

export interface FakeSizeInit {
  inlineSize?: number;
  blockSize?: number;
}

export interface FakeResizeEntryInit {
  target?: Element;
  contentRect?: FakeRectInit;
  contentBoxSize?: FakeSizeInit[];
  borderBoxSize?: FakeSizeInit[];
  devicePixelContentBoxSize?: FakeSizeInit[];
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

function makeSizes(init?: FakeSizeInit[]): ReadonlyArray<ResizeObserverSize> | undefined {
  if (!init) return undefined;
  return init.map((s) => ({ inlineSize: s.inlineSize ?? 0, blockSize: s.blockSize ?? 0 })) as ReadonlyArray<ResizeObserverSize>;
}

/** Convenience: a single boxSize fragment of `[{ inlineSize, blockSize }]`. */
export function size(inlineSize: number, blockSize: number): FakeSizeInit[] {
  return [{ inlineSize, blockSize }];
}

/** Build a ResizeObserverEntry-like object from a partial init. */
export function makeEntry(init: FakeResizeEntryInit = {}): ResizeObserverEntry {
  return {
    target: init.target ?? document.createElement("div"),
    contentRect: makeRect(init.contentRect),
    contentBoxSize: makeSizes(init.contentBoxSize),
    borderBoxSize: makeSizes(init.borderBoxSize),
    devicePixelContentBoxSize: makeSizes(init.devicePixelContentBoxSize),
  } as unknown as ResizeObserverEntry;
}

export class FakeResizeObserver {
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  observedBoxes: (string | undefined)[] = [];
  disconnected = false;
  private _throwBoxes: Set<string>;

  constructor(callback: ResizeObserverCallback, throwBoxes: Set<string>) {
    this.callback = callback;
    this._throwBoxes = throwBoxes;
  }

  observe(element: Element, options: ResizeObserverOptions = {}): void {
    const box = options.box;
    if (this._throwBoxes.has("*") || (box !== undefined && this._throwBoxes.has(box))) {
      throw new TypeError(`unsupported box option: ${box}`);
    }
    this.observed.push(element);
    this.observedBoxes.push(box);
  }

  unobserve(_element: Element): void {
    // The single-target Core tears down via disconnect() (it rebuilds the observer
    // to reconfigure), so the native unobserve() is never exercised — modeled here
    // only to satisfy the ResizeObserver shape.
  }

  disconnect(): void {
    this.disconnected = true;
    this.observed = [];
    this.observedBoxes = [];
  }

  /** Deliver entries to the stored callback, as the browser would. */
  emit(entries: ResizeObserverEntry[]): void {
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

export interface ResizeObserverController {
  instances: FakeResizeObserver[];
  readonly last: FakeResizeObserver;
  /** Emit a single entry (defaulting target to the last observed element) to the latest observer. */
  emit(init?: FakeResizeEntryInit): void;
}

/**
 * Install a controllable ResizeObserver fake on globalThis. Pass `throwBoxes` to
 * simulate the runtime rejecting specific box options on observe() — `["*"]` throws
 * for every box, `["device-pixel-content-box"]` only for that one.
 */
export function installResizeObserver(opts: { throwBoxes?: string[] } = {}): ResizeObserverController {
  const instances: FakeResizeObserver[] = [];
  const throwBoxes = new Set(opts.throwBoxes ?? []);

  class RO extends FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      super(callback, throwBoxes);
      instances.push(this);
    }
  }

  (globalThis as any).ResizeObserver = RO;

  const controller: ResizeObserverController = {
    instances,
    get last() {
      return instances[instances.length - 1];
    },
    emit(init: FakeResizeEntryInit = {}) {
      const obs = instances[instances.length - 1];
      const target = init.target ?? obs.observed[obs.observed.length - 1];
      obs.emit([makeEntry({ ...init, target })]);
    },
  };

  return controller;
}

/** Remove ResizeObserver so the "unsupported" branch can be tested. */
export function removeResizeObserver(): void {
  (globalThis as any).ResizeObserver = undefined;
}
