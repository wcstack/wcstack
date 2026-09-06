// happy-dom implements neither the View Transition API nor matchMedia, so the
// tests drive their own. The fake never runs the update callback on its own:
// every test decides when the "capturing" window closes, because that window is
// where the arbiter's ordering guarantees live.

export interface FakeTransition {
  readonly updateCallbackDone: Promise<void>;
  readonly finished: Promise<void>;
  readonly ready: Promise<void>;
  readonly types?: string[];
  readonly usedOptionsForm: boolean;
  skipped: boolean;
  updateRan: boolean;
  skipTransition(): void;
  /** Close the capturing window: invoke the update callback. */
  runUpdate(): void;
  /** Settle `finished` (implies runUpdate, as the real API does). */
  finish(): void;
  /** Reject `updateCallbackDone`, as the real API does when the callback throws. */
  failUpdateCallback(error: unknown): void;
  /** Invoke the update callback again, bypassing the once-guard. */
  callUpdateAgain(): void;
}

export interface ViewTransitionMock {
  readonly transitions: FakeTransition[];
  /** Make `startViewTransition` throw on the next call(s). */
  throwOnStart: Error | null;
  uninstall(): void;
}

export function installViewTransitionMock(): ViewTransitionMock {
  const transitions: FakeTransition[] = [];
  const mock: ViewTransitionMock = {
    transitions,
    throwOnStart: null,
    uninstall() {
      delete (document as unknown as Record<string, unknown>).startViewTransition;
    },
  };

  const start = (arg: (() => void) | { update: () => void; types?: string[] }): FakeTransition => {
    if (mock.throwOnStart !== null) {
      throw mock.throwOnStart;
    }
    const usedOptionsForm = typeof arg !== "function";
    const update = typeof arg === "function" ? arg : arg.update;
    const types = typeof arg === "function" ? undefined : arg.types;

    let resolveUpdate!: () => void;
    let rejectUpdate!: (reason: unknown) => void;
    let resolveFinished!: () => void;
    let resolveReady!: () => void;
    let rejectReady!: (reason: unknown) => void;
    const updateCallbackDone = new Promise<void>((r, j) => { resolveUpdate = r; rejectUpdate = j; });
    const finished = new Promise<void>((r) => { resolveFinished = r; });
    const ready = new Promise<void>((r, j) => { resolveReady = r; rejectReady = j; });

    const transition: FakeTransition = {
      updateCallbackDone,
      finished,
      ready,
      types,
      usedOptionsForm,
      skipped: false,
      updateRan: false,
      runUpdate() {
        if (transition.updateRan) return;
        transition.updateRan = true;
        update();
        resolveUpdate();
      },
      finish() {
        transition.runUpdate();
        resolveReady();
        resolveFinished();
      },
      failUpdateCallback(error: unknown) {
        rejectUpdate(error);
      },
      callUpdateAgain() {
        update();
      },
      skipTransition() {
        transition.skipped = true;
        // The real API rejects `ready` on a skip; routine, and never an error.
        rejectReady(new Error("skipped"));
        transition.finish();
      },
    };
    transitions.push(transition);
    return transition;
  };

  (document as unknown as Record<string, unknown>).startViewTransition = start;
  return mock;
}

/** Declare `ViewTransition.prototype.types`, the `startViewTransition({ types })` feature probe. */
export function installTypesSupport(supported: boolean | "throw"): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = "ViewTransition" in g;
  const previous = g.ViewTransition;
  class FakeViewTransition {}
  if (supported === true) {
    Object.defineProperty(FakeViewTransition.prototype, "types", { value: null, configurable: true });
  }
  // A class's own `prototype` is non-configurable, so the throwing probe is a
  // plain object with a throwing getter instead.
  g.ViewTransition = supported === "throw"
    ? { get prototype(): object { throw new Error("prototype access exploded"); } }
    : FakeViewTransition;
  return () => {
    if (had) {
      g.ViewTransition = previous;
    } else {
      delete g.ViewTransition;
    }
  };
}

export function installMatchMedia(matches: boolean | "throw"): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = "matchMedia" in g;
  const previous = g.matchMedia;
  g.matchMedia = (_query: string) => {
    if (matches === "throw") throw new Error("matchMedia exploded");
    return { matches };
  };
  return () => {
    if (had) {
      g.matchMedia = previous;
    } else {
      delete g.matchMedia;
    }
  };
}

export function removeMatchMedia(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = "matchMedia" in g;
  const previous = g.matchMedia;
  delete g.matchMedia;
  return () => {
    if (had) {
      g.matchMedia = previous;
    }
  };
}

export function setDocumentHidden(hidden: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
  return () => {
    delete (document as unknown as Record<string, unknown>).hidden;
    if (descriptor !== undefined && !Object.getOwnPropertyDescriptor(Document.prototype, "hidden")) {
      Object.defineProperty(Document.prototype, "hidden", descriptor);
    }
  };
}

/** Let queued microtasks run. */
export function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}
