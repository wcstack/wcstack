import { vi } from "vitest";

/**
 * Minimal SpeechSynthesisUtterance stand-in. The Core attaches lifecycle
 * handlers via `utterance.onstart = ...` etc.; the mock just needs settable
 * fields and handler slots. Tests drive the handlers through the FakeSynth
 * helpers below.
 */
export class FakeUtterance {
  text: string;
  lang = "";
  voice: unknown = null;
  rate = 1;
  pitch = 1;
  volume = 1;

  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;
  onboundary: ((event: any) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

export interface FakeVoice {
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
  voiceURI: string;
}

export function makeVoice(overrides: Partial<FakeVoice> = {}): FakeVoice {
  return {
    name: "Test Voice",
    lang: "en-US",
    default: false,
    localService: true,
    voiceURI: "test-voice",
    ...overrides,
  };
}

/**
 * Controllable window.speechSynthesis mock. `speak()` records each utterance so
 * a test can drive its lifecycle (`fireStart` / `fireBoundary` / `fireEnd` /
 * `fireError` / `firePause` / `fireResume`). `cancel()` simulates the browser by
 * firing a "canceled" error on every recorded utterance, so the Core's
 * generation guard can be exercised.
 */
export class FakeSynth {
  speak = vi.fn((u: FakeUtterance) => { this.utterances.push(u); });
  pause = vi.fn();
  resume = vi.fn();

  utterances: FakeUtterance[] = [];
  private _voices: FakeVoice[];
  private _voicesChanged: Set<() => void> = new Set();

  constructor(voices: FakeVoice[] = []) {
    this._voices = voices;
  }

  getVoices = (): FakeVoice[] => this._voices;

  cancel = vi.fn(() => {
    // The browser fires a "canceled" error per queued/active utterance.
    for (const u of this.utterances) {
      u.onerror?.({ error: "canceled" });
    }
  });

  addEventListener = (type: string, fn: () => void): void => {
    if (type === "voiceschanged") this._voicesChanged.add(fn);
  };

  removeEventListener = (type: string, fn: () => void): void => {
    if (type === "voiceschanged") this._voicesChanged.delete(fn);
  };

  // --- Test drivers ---

  /** Replace the voice list and notify subscribers (voiceschanged). */
  setVoices(voices: FakeVoice[]): void {
    this._voices = voices;
    for (const fn of this._voicesChanged) fn();
  }

  /** Number of live voiceschanged listeners (to assert dispose detaches them). */
  get voicesChangedListenerCount(): number {
    return this._voicesChanged.size;
  }

  private _at(index: number): FakeUtterance | undefined {
    return index < 0 ? this.utterances[this.utterances.length + index] : this.utterances[index];
  }

  fireStart(index = -1): void {
    this._at(index)?.onstart?.();
  }

  fireBoundary(detail: { charIndex: number; charLength?: number }, index = -1): void {
    this._at(index)?.onboundary?.(detail);
  }

  fireEnd(index = -1): void {
    this._at(index)?.onend?.();
  }

  fireError(error: string, index = -1): void {
    this._at(index)?.onerror?.({ error });
  }

  firePause(index = -1): void {
    this._at(index)?.onpause?.();
  }

  fireResume(index = -1): void {
    this._at(index)?.onresume?.();
  }
}

/**
 * Install a FakeSynth (and FakeUtterance) onto the global window. Returns the
 * mock so the test can drive it. Call uninstallSpeechSynthesis() in afterEach.
 */
export function installSpeechSynthesis(voices: FakeVoice[] = []): FakeSynth {
  const synth = new FakeSynth(voices);
  (window as any).speechSynthesis = synth;
  (window as any).SpeechSynthesisUtterance = FakeUtterance;
  return synth;
}

/** Remove the SpeechSynthesis mock so an "unsupported" environment can be tested. */
export function uninstallSpeechSynthesis(): void {
  delete (window as any).speechSynthesis;
  delete (window as any).SpeechSynthesisUtterance;
}

// ---------------------------------------------------------------------------
// SpeechRecognition (STT) mock
// ---------------------------------------------------------------------------

/**
 * Controllable SpeechRecognition stand-in. The Core creates one instance in its
 * constructor and attaches handlers; tests drive it through fireStart /
 * fireResult / fireError / fireEnd. start/stop/abort are spies (they do NOT fire
 * events — the test drives the lifecycle explicitly, matching how the real API
 * is asynchronous).
 */
export class FakeRecognition extends EventTarget {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;

  onstart: ((e: any) => void) | null = null;
  onend: ((e: any) => void) | null = null;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;

  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  fireStart(): void {
    this.onstart?.(new Event("start"));
  }

  fireEnd(): void {
    this.onend?.(new Event("end"));
  }

  fireError(error: string): void {
    this.onerror?.({ error });
  }

  fireResult(results: any, resultIndex = 0): void {
    this.onresult?.({ results, resultIndex });
  }
}

/**
 * Build a SpeechRecognitionResultList-like value. Each item becomes a result
 * (with `isFinal`, indexable alternatives, and `length`).
 */
export function makeResults(
  items: Array<{ transcript: string; confidence?: number; isFinal?: boolean; alternatives?: Array<{ transcript: string; confidence: number }> }>,
): any {
  const list: any = items.map((it) => {
    const alts = it.alternatives ?? [{ transcript: it.transcript, confidence: it.confidence ?? 0.9 }];
    const res: any = alts.slice();
    res.isFinal = it.isFinal ?? false;
    return res;
  });
  return list;
}

/** Install a SpeechRecognition (or webkit-prefixed) constructor. Returns the array of created instances. */
export function installSpeechRecognition(opts: { prefixed?: boolean } = {}): FakeRecognition[] {
  const instances: FakeRecognition[] = [];
  class Ctor extends FakeRecognition {
    constructor() {
      super();
      instances.push(this);
    }
  }
  if (opts.prefixed) {
    (window as any).webkitSpeechRecognition = Ctor;
  } else {
    (window as any).SpeechRecognition = Ctor;
  }
  return instances;
}

export function uninstallSpeechRecognition(): void {
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
}

// ---------------------------------------------------------------------------
// Permissions API mock (microphone) — mirrors @wcstack/geolocation
// ---------------------------------------------------------------------------

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

export function installPermissions(opts: { state?: string; reject?: boolean } = {}): PermissionStatusMock {
  const base = makePermissionStatus(opts.state ?? "prompt");
  const query = opts.reject
    ? vi.fn(() => Promise.reject(new TypeError("unsupported permission name")))
    : vi.fn(() => Promise.resolve(base));
  Object.defineProperty(navigator, "permissions", {
    value: { query },
    configurable: true,
    writable: true,
  });
  return base;
}

export function removePermissions(): void {
  Object.defineProperty(navigator, "permissions", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}
