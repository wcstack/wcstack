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
    remove: () => removePointerLockDoc(),
  };
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
