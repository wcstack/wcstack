import { vi } from "vitest";

// Controllable stand-ins for the Web MIDI API, which happy-dom does not
// implement. Shaped after the real objects: ports live in Maps keyed by id,
// input delivery goes through the `onmidimessage` property (not addEventListener),
// and MIDIAccess.onstatechange fires on every plug/unplug.

export class FakeMidiPort extends EventTarget {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: string;
  type: string;

  constructor(id: string, name: string | null = id, type = "input") {
    super();
    this.id = id;
    this.name = name;
    this.manufacturer = "wcstack";
    this.state = "connected";
    this.type = type;
  }
}

export class FakeMidiInput extends FakeMidiPort {
  onmidimessage: ((event: any) => void) | null = null;

  constructor(id: string, name: string | null = id) {
    super(id, name, "input");
  }

  /** Deliver a message exactly as the browser would. */
  emit(data: number[], timeStamp?: number): void {
    this.onmidimessage?.({
      data: new Uint8Array(data),
      target: this,
      ...(timeStamp === undefined ? {} : { timeStamp }),
    });
  }

  /** Deliver a raw event, for the malformed-payload paths. */
  emitRaw(event: any): void {
    this.onmidimessage?.(event);
  }
}

export class FakeMidiOutput extends FakeMidiPort {
  sent: { data: number[] | Uint8Array; timestamp?: number }[] = [];
  throwOnSend: Error | null = null;

  constructor(id: string, name: string | null = id) {
    super(id, name, "output");
  }

  send(data: number[] | Uint8Array, timestamp?: number): void {
    if (this.throwOnSend) throw this.throwOnSend;
    this.sent.push({ data, timestamp });
  }
}

export class FakeMidiAccess {
  inputs = new Map<string, FakeMidiInput>();
  outputs = new Map<string, FakeMidiOutput>();
  onstatechange: ((event: any) => void) | null = null;
  sysexEnabled = false;

  addInput(port: FakeMidiInput): FakeMidiInput {
    this.inputs.set(port.id, port);
    this.onstatechange?.({ port });
    return port;
  }

  addOutput(port: FakeMidiOutput): FakeMidiOutput {
    this.outputs.set(port.id, port);
    this.onstatechange?.({ port });
    return port;
  }

  removeInput(id: string): void {
    const port = this.inputs.get(id);
    this.inputs.delete(id);
    this.onstatechange?.({ port });
  }

  /** Unplug without removing the entry, as browsers do (state flips first). */
  disconnectInput(id: string): void {
    const port = this.inputs.get(id);
    if (port) port.state = "disconnected";
    this.onstatechange?.({ port });
  }
}

export interface MidiMock {
  requestMIDIAccess: ReturnType<typeof vi.fn>;
  access: FakeMidiAccess;
  /** Options passed to each requestMIDIAccess() call, in order. */
  calls: any[];
}

/**
 * Install navigator.requestMIDIAccess. By default it resolves on the next
 * microtask (as the real API does) with a pre-populated access object holding
 * one input and one output.
 */
export function installMidi(opts: {
  access?: FakeMidiAccess;
  reject?: Error;
  empty?: boolean;
} = {}): MidiMock {
  const access = opts.access ?? new FakeMidiAccess();
  if (!opts.access && !opts.empty) {
    access.inputs.set("in-1", new FakeMidiInput("in-1", "Keystation 49"));
    access.outputs.set("out-1", new FakeMidiOutput("out-1", "Keystation 49"));
  }
  const calls: any[] = [];
  const requestMIDIAccess = vi.fn((options: any) => {
    calls.push(options);
    return opts.reject ? Promise.reject(opts.reject) : Promise.resolve(access);
  });

  Object.defineProperty(globalThis.navigator, "requestMIDIAccess", {
    value: requestMIDIAccess,
    configurable: true,
    writable: true,
  });

  return { requestMIDIAccess, access, calls };
}

/** Remove navigator.requestMIDIAccess so the "unsupported" branch can be tested. */
export function removeMidi(): void {
  Object.defineProperty(globalThis.navigator, "requestMIDIAccess", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/** Remove navigator entirely (SSR / worker context). Returns a restore function. */
export function removeNavigator(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
  };
}

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

export interface PermissionsMock {
  query: ReturnType<typeof vi.fn>;
  statuses: PermissionStatusMock[];
  descriptors: any[];
}

/** Install navigator.permissions, whose query() resolves asynchronously. */
export function installPermissions(opts: { state?: string; reject?: boolean } = {}): PermissionsMock {
  const statuses: PermissionStatusMock[] = [];
  const descriptors: any[] = [];

  const query = vi.fn((descriptor: any) => {
    descriptors.push(descriptor);
    if (opts.reject) return Promise.reject(new TypeError("unknown permission name"));
    const status = makePermissionStatus(opts.state ?? "prompt");
    statuses.push(status);
    return Promise.resolve(status);
  });

  Object.defineProperty(globalThis.navigator, "permissions", {
    value: { query },
    configurable: true,
    writable: true,
  });

  return { query, statuses, descriptors };
}

/** Remove navigator.permissions (the descriptor-unsupported fallback path). */
export function removePermissions(): void {
  Object.defineProperty(globalThis.navigator, "permissions", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/** Flush pending microtasks so a request()'s .then() runs. */
export function flush(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve()).then(() => Promise.resolve());
}

/** Collect every event of `name` dispatched on `target`. */
export function record(target: EventTarget, name: string): any[] {
  const seen: any[] = [];
  target.addEventListener(name, (e) => seen.push((e as CustomEvent).detail));
  return seen;
}
