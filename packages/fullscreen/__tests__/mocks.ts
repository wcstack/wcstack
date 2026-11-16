// happy-dom does not implement the Fullscreen API (Element.requestFullscreen,
// document.exitFullscreen, document.fullscreenElement, fullscreenchange), so
// every test installs a controllable fake via the helpers below. Both the
// standard names and the legacy webkit-prefixed names can be installed
// independently, so tests can exercise the "standard only" / "legacy only" /
// "neither" (unsupported) matrices called out in
// docs/fullscreen-tag-design.md §4/§11.

type FullscreenFn = () => Promise<void>;

/** Options controlling how a stubbed requestFullscreen()/exitFullscreen() resolves. */
export interface StubBehavior {
  /** If set, the stub rejects with this value instead of resolving. */
  rejectWith?: any;
}

/**
 * Install `element.requestFullscreen` (and/or the legacy
 * `webkitRequestFullscreen`) as a stub. On success, sets
 * `document.fullscreenElement` (or the legacy field) to `element` and fires
 * `fullscreenchange` (or `webkitfullscreenchange`) on `document`.
 */
export function stubRequestFullscreen(
  element: Element,
  opts: { legacy?: boolean } & StubBehavior = {},
): FullscreenFn {
  const fn: FullscreenFn = async () => {
    if (opts.rejectWith !== undefined) {
      throw opts.rejectWith;
    }
    setFullscreenElement(element, { legacy: opts.legacy });
    dispatchFullscreenChange({ legacy: opts.legacy });
  };
  const key = opts.legacy ? "webkitRequestFullscreen" : "requestFullscreen";
  (element as any)[key] = fn;
  return fn;
}

/**
 * Install `document.exitFullscreen` (and/or the legacy
 * `webkitExitFullscreen`) as a stub. On success, clears
 * `document.fullscreenElement` (or the legacy field) and fires
 * `fullscreenchange` (or `webkitfullscreenchange`) on `document`.
 */
export function stubExitFullscreen(
  opts: { legacy?: boolean } & StubBehavior = {},
): FullscreenFn {
  const fn: FullscreenFn = async () => {
    if (opts.rejectWith !== undefined) {
      throw opts.rejectWith;
    }
    setFullscreenElement(null, { legacy: opts.legacy });
    dispatchFullscreenChange({ legacy: opts.legacy });
  };
  const key = opts.legacy ? "webkitExitFullscreen" : "exitFullscreen";
  (document as any)[key] = fn;
  return fn;
}

/**
 * Install `requestFullscreen` (or the legacy `webkitRequestFullscreen`) on
 * `Element.prototype` — where the platform defines the real API — instead of
 * on an element instance. This is how a real browser environment looks, and
 * it exercises FullscreenCore's shadow-safe resolution (own property →
 * Element.prototype, skipping subclass prototypes such as WcsFullscreen's own
 * `requestFullscreen()` command method). The stub uses `this` (the call
 * receiver) as the fullscreened element. Returns a restore function that
 * removes the stub — always call it (try/finally).
 */
export function stubRequestFullscreenOnElementPrototype(
  opts: { legacy?: boolean } & StubBehavior = {},
): () => void {
  const proto = Element.prototype as any;
  const key = opts.legacy ? "webkitRequestFullscreen" : "requestFullscreen";
  proto[key] = async function (this: Element) {
    if (opts.rejectWith !== undefined) {
      throw opts.rejectWith;
    }
    setFullscreenElement(this, { legacy: opts.legacy });
    dispatchFullscreenChange({ legacy: opts.legacy });
  };
  return () => {
    delete proto[key];
  };
}

/** Remove both standard and legacy requestFullscreen from `element`. */
export function removeRequestFullscreen(element: Element): void {
  delete (element as any).requestFullscreen;
  delete (element as any).webkitRequestFullscreen;
}

/** Remove both standard and legacy exitFullscreen from `document`. */
export function removeExitFullscreen(): void {
  delete (document as any).exitFullscreen;
  delete (document as any).webkitExitFullscreen;
}

/** Directly set (or clear) `document.fullscreenElement` (and/or legacy field). */
export function setFullscreenElement(element: Element | null, opts: { legacy?: boolean } = {}): void {
  const key = opts.legacy ? "webkitFullscreenElement" : "fullscreenElement";
  Object.defineProperty(document, key, {
    value: element,
    configurable: true,
    writable: true,
  });
}

/** Clear both standard and legacy fullscreenElement fields to null. */
export function clearFullscreenElement(): void {
  Object.defineProperty(document, "fullscreenElement", {
    value: null,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(document, "webkitFullscreenElement", {
    value: null,
    configurable: true,
    writable: true,
  });
}

/** Manually dispatch fullscreenchange (or webkitfullscreenchange) on document. */
export function dispatchFullscreenChange(opts: { legacy?: boolean } = {}): void {
  const name = opts.legacy ? "webkitfullscreenchange" : "fullscreenchange";
  document.dispatchEvent(new Event(name));
}

/** Manually dispatch fullscreenerror (or webkitfullscreenerror) on document. */
export function dispatchFullscreenError(opts: { legacy?: boolean } = {}): void {
  const name = opts.legacy ? "webkitfullscreenerror" : "fullscreenerror";
  document.dispatchEvent(new Event(name));
}

/**
 * Install `document.fullscreenEnabled` (or the legacy `webkitFullscreenEnabled`),
 * which happy-dom does not define. `resetFullscreenEnvironment()` removes both.
 */
export function setFullscreenEnabled(value: unknown, opts: { legacy?: boolean } = {}): void {
  const key = opts.legacy ? "webkitFullscreenEnabled" : "fullscreenEnabled";
  Object.defineProperty(document, key, {
    value,
    configurable: true,
    writable: true,
  });
}

/**
 * Make the page one that can use element fullscreen: `document.fullscreenEnabled`
 * true and `requestFullscreen` on `Element.prototype` (or the legacy names).
 * Returns a restore function for the prototype stub — always call it
 * (try/finally); `resetFullscreenEnvironment()` removes the document field.
 */
export function installFullscreenSupport(opts: { legacy?: boolean } = {}): () => void {
  setFullscreenEnabled(true, opts);
  return stubRequestFullscreenOnElementPrototype(opts);
}

/** Reset all fullscreen-related fields/methods installed by these helpers. */
export function resetFullscreenEnvironment(): void {
  clearFullscreenElement();
  removeExitFullscreen();
  delete (document as any).onfullscreenchange;
  delete (document as any).fullscreenEnabled;
  delete (document as any).webkitFullscreenEnabled;
  delete (document as any).permissionsPolicy;
  delete (document as any).featurePolicy;
}

/**
 * Find the prototype-chain link that actually owns `name` as an own property
 * (mirroring what the `in` operator checks), rather than assuming it sits
 * exactly one level up. happy-dom defines the `on…` handlers on `Document`'s
 * prototype, which is *not* `Object.getPrototypeOf(document)` (that one level
 * up is `HTMLDocument.prototype`) — walking the chain keeps this helper
 * correct even if that depth shifts in a future happy-dom version.
 */
function findDocumentPropertyOwner(name: string): object | null {
  let proto: object | null = document as unknown as object;
  while (proto) {
    if (Object.prototype.hasOwnProperty.call(proto, name)) {
      return proto;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

/**
 * Temporarily remove the named `on…` handler properties from wherever they
 * actually live on `document`'s prototype chain, run `fn` (sync or async), then
 * always restore them — so a test can force the legacy branch of
 * `_fullscreenChangeEventName()` / `_fullscreenErrorEventName()` without
 * depending on a fixed prototype depth. A name that is already absent (e.g. a
 * future happy-dom without the property at all) is skipped: its legacy branch
 * is already reachable, there is nothing to remove or restore.
 */
export async function withoutDocumentHandlers(names: string[], fn: () => void | Promise<void>): Promise<void> {
  const removed: Array<{ owner: object; name: string; descriptor: PropertyDescriptor }> = [];
  for (const name of names) {
    const owner = findDocumentPropertyOwner(name);
    if (!owner) continue;
    removed.push({ owner, name, descriptor: Object.getOwnPropertyDescriptor(owner, name)! });
    delete (owner as any)[name];
  }
  try {
    await fn();
  } finally {
    for (const { owner, name, descriptor } of removed) {
      Object.defineProperty(owner, name, descriptor);
    }
  }
}

/**
 * `withoutDocumentHandlers(["onfullscreenchange"], fn)` — forces
 * `_fullscreenChangeEventName()`'s legacy branch.
 */
export async function withoutOnfullscreenchange(fn: () => void | Promise<void>): Promise<void> {
  await withoutDocumentHandlers(["onfullscreenchange"], fn);
}
