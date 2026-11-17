/**
 * Fake double for the Pointer Lock API. happy-dom implements neither
 * `Element.prototype.requestPointerLock` nor `document.exitPointerLock`/
 * `document.pointerLockElement`/`pointerlockchange`, so every test installs
 * this controllable fake instead of touching the real platform API.
 */

export interface InstallPointerLockDocOptions {
  /** Expose the standard API names (`requestPointerLock`/`exitPointerLock`/... ). Default: true. */
  standard?: boolean;
  /** Also expose the legacy `webkit`-prefixed names. Default: false. */
  legacy?: boolean;
}

export interface FakePointerLockDoc {
  /** Read the element currently "locked", or null. */
  getLockedElement(): Element | null;
  /**
   * Programmatically set the locked element and dispatch `pointerlockchange`
   * (and `webkitpointerlockchange` when legacy names are installed), mirroring
   * how a real user gesture would flip `document.pointerLockElement`.
   */
  setLockedElement(el: Element | null): void;
  /** Dispatch `pointerlockchange` (and legacy alias) without changing state. */
  fireChange(): void;
  /**
   * Dispatch `pointerlockerror` (and `webkitpointerlockerror` when legacy names
   * are installed) on `document`, as a browser does for a refused request.
   */
  fireError(): void;
  /** Remove all installed properties/stubs from `document`/`Element.prototype`. */
  remove(): void;
}

const ELEMENT_KEYS = ["requestPointerLock", "webkitRequestPointerLock"] as const;
const DOC_KEYS = ["exitPointerLock", "webkitExitPointerLock", "pointerLockElement", "webkitPointerLockElement"] as const;

/**
 * Install a controllable Pointer Lock fake onto `document`/`Element.prototype`.
 *
 * By default `element.requestPointerLock()` resolves successfully and sets
 * `document.pointerLockElement` to that element; pass `requestImpl` to
 * override (e.g. to simulate a `NotAllowedError` rejection).
 */
export function installPointerLockDoc(
  options: InstallPointerLockDocOptions = {},
  requestImpl?: (this: Element) => Promise<void>,
): FakePointerLockDoc {
  const { standard = true, legacy = false } = options;
  let locked: Element | null = null;

  const dispatchChange = () => {
    if (standard) {
      document.dispatchEvent(new Event("pointerlockchange"));
    }
    if (legacy) {
      document.dispatchEvent(new Event("webkitpointerlockchange"));
    }
  };

  const dispatchError = () => {
    if (standard) {
      document.dispatchEvent(new Event("pointerlockerror"));
    }
    if (legacy) {
      document.dispatchEvent(new Event("webkitpointerlockerror"));
    }
  };

  const defaultRequest = function (this: Element): Promise<void> {
    locked = this;
    dispatchChange();
    return Promise.resolve();
  };

  const request = requestImpl ?? defaultRequest;

  if (standard) {
    Object.defineProperty(document, "onpointerlockchange", {
      value: null,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(Element.prototype, "requestPointerLock", {
      value: request,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, "exitPointerLock", {
      value: function (this: Document): void {
        locked = null;
        dispatchChange();
      },
      configurable: true,
      writable: true,
    });
  }

  if (legacy) {
    Object.defineProperty(Element.prototype, "webkitRequestPointerLock", {
      value: request,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(document, "webkitExitPointerLock", {
      value: function (this: Document): void {
        locked = null;
        dispatchChange();
      },
      configurable: true,
      writable: true,
    });
  }

  Object.defineProperty(document, "pointerLockElement", {
    get: () => (standard ? locked : null),
    configurable: true,
  });
  Object.defineProperty(document, "webkitPointerLockElement", {
    get: () => (legacy ? locked : null),
    configurable: true,
  });

  return {
    getLockedElement: () => locked,
    setLockedElement: (el: Element | null) => {
      locked = el;
      dispatchChange();
    },
    fireChange: dispatchChange,
    fireError: dispatchError,
    remove: () => removePointerLockDoc(),
  };
}

/**
 * Find the prototype-chain link that actually owns `name` as an own property
 * (mirroring what the `in` operator checks). happy-dom defines the `on…`
 * handlers on `Document`'s prototype, which is not `Object.getPrototypeOf(document)`
 * — walking the chain keeps this correct if that depth shifts.
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
 * Temporarily remove the named `on…` handler properties from wherever they live
 * on `document`'s prototype chain, run `fn` (sync or async), then always restore
 * them — so a test can make `"onpointerlockerror" in document` false and drive
 * the legacy (`webkit`-prefixed) event-name branch. A name that is already
 * absent is skipped (nothing to remove or restore).
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

/** Remove all Pointer Lock stubs installed by installPointerLockDoc(), restoring an unsupported environment. */
export function removePointerLockDoc(): void {
  for (const key of ELEMENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(Element.prototype, key)) {
      delete (Element.prototype as any)[key];
    }
  }
  for (const key of DOC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(document, key)) {
      delete (document as any)[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(document, "onpointerlockchange")) {
    delete (document as any).onpointerlockchange;
  }
}
