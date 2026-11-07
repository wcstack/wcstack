// A page may only hold a handful of AudioContexts before browsers start
// refusing to create more, so every <wcs-audio> on a page shares one. The
// registry key is a `Symbol.for`, not a module-level variable, so two copies of
// this bundle (a version-mixed CDN page) still converge on a single context
// instead of quietly splitting the page's audio in two.
const SHARED = Symbol.for("@wcstack/audio.context");

type ContextCtor = new () => BaseAudioContext;

interface ContextRegistry {
  [SHARED]?: BaseAudioContext;
  AudioContext?: ContextCtor;
  webkitAudioContext?: ContextCtor;
  navigator?: { userActivation?: { hasBeenActive?: boolean } };
}

/**
 * Default context provider: one lazily created, page-wide `AudioContext`.
 * Returns `null` where Web Audio is absent (SSR, or a browser without it) so the
 * caller can report `"unsupported"` instead of throwing.
 *
 * Resolved at call time, never cached in a field, so tests can swap the global
 * and an unsupported environment is reported honestly.
 */
export function defaultCreateContext(): BaseAudioContext | null {
  const registry = globalThis as unknown as ContextRegistry;
  const existing = registry[SHARED];
  if (existing) return existing;
  const Ctor = registry.AudioContext ?? registry.webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  registry[SHARED] = ctx;
  return ctx;
}

/**
 * Whether `defaultCreateContext()` would now create an `AudioContext` the
 * browser refuses to start: none exists yet, Web Audio is there, and the page
 * has had no user gesture (`navigator.userActivation.hasBeenActive`; where the
 * API is missing, assume none). Chromium and Firefox print a warning for such a
 * context, so `<wcs-audio>` waits for the gesture instead (4.17).
 *
 * False where Web Audio is absent: the caller should go on and report
 * `"unsupported"` at once rather than wait for a gesture that changes nothing.
 */
export function contextAwaitsGesture(): boolean {
  const registry = globalThis as unknown as ContextRegistry;
  if (registry[SHARED]) return false;
  if (!(registry.AudioContext ?? registry.webkitAudioContext)) return false;
  return registry.navigator?.userActivation?.hasBeenActive !== true;
}

/** Drop the shared context (tests, and pages that tear everything down). */
export function releaseSharedContext(): void {
  const registry = globalThis as unknown as ContextRegistry;
  delete registry[SHARED];
}
