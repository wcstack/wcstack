// Fakes for the Media Capture / Recording APIs that happy-dom does not implement.
// Each test installs the pieces it needs and restores globals in afterEach.

export class FakeMediaStreamTrack {
  stopped = false;
  private _listeners: Record<string, Array<(e: Event) => void>> = {};
  constructor(
    public kind: string = "video",
    private _settings: MediaTrackSettings = { deviceId: "cam-1" },
  ) {}
  stop(): void { this.stopped = true; }
  getSettings(): MediaTrackSettings { return this._settings; }
  addEventListener(type: string, fn: (e: Event) => void): void {
    (this._listeners[type] ||= []).push(fn);
  }
  removeEventListener(type: string, fn: (e: Event) => void): void {
    this._listeners[type] = (this._listeners[type] ?? []).filter((f) => f !== fn);
  }
  /** Simulate the OS revoking this track. */
  end(): void {
    for (const fn of this._listeners["ended"] ?? []) fn(new Event("ended"));
  }
}

// Extend happy-dom's MediaStream (when present) so the instance passes the
// `srcObject instanceof MediaStream` check happy-dom enforces on <video>. The
// track methods are unimplemented there, so we override them. Falls back to a
// plain base outside happy-dom.
const StreamBase: { new (): object } =
  typeof (globalThis as { MediaStream?: { new (): object } }).MediaStream === "function"
    ? (globalThis as unknown as { MediaStream: { new (): object } }).MediaStream
    : (class {} as { new (): object });

export class FakeMediaStream extends StreamBase {
  id: string;
  tracks: FakeMediaStreamTrack[];
  constructor(id: string = "stream-1", tracks: FakeMediaStreamTrack[] = [new FakeMediaStreamTrack()]) {
    super();
    this.id = id;
    this.tracks = tracks;
  }
  getTracks(): FakeMediaStreamTrack[] { return this.tracks; }
  getVideoTracks(): FakeMediaStreamTrack[] { return this.tracks.filter((t) => t.kind === "video"); }
  getAudioTracks(): FakeMediaStreamTrack[] { return this.tracks.filter((t) => t.kind === "audio"); }
}

export class FakePermissionStatus extends EventTarget {
  constructor(public state: string) { super(); }
  /** Simulate a live permission change (e.g. user flips it in settings). */
  set(state: string): void {
    this.state = state;
    this.dispatchEvent(new Event("change"));
  }
}

interface MediaControl {
  /** What getUserMedia returns next (a stream) or throws (an error with `name`). */
  nextStream: FakeMediaStream | null;
  nextError: { name: string; message?: string } | null;
  /** Captured calls. */
  calls: MediaStreamConstraints[];
  /** Registered permission statuses by descriptor name. */
  permissionStatuses: Map<string, FakePermissionStatus>;
  /** Make navigator.permissions.query reject (e.g. Firefox camera descriptor). */
  rejectPermissionQuery: boolean;
  devices: MediaDeviceInfo[];
}

const originals: { mediaDevices?: unknown; permissions?: unknown } = {};

export interface InstalledMedia {
  control: MediaControl;
  /** Set the stream getUserMedia resolves with next. */
  resolveWith(stream: FakeMediaStream): void;
  /** Set the error getUserMedia rejects with next. */
  rejectWith(name: string, message?: string): void;
  setPermission(name: "camera" | "microphone", state: string): FakePermissionStatus;
  emitDeviceChange(): void;
  uninstall(): void;
}

/**
 * Install fake navigator.mediaDevices + navigator.permissions. Pass
 * `{ noMediaDevices: true }` to simulate an insecure/legacy context, or
 * `{ noPermissions: true }` to drop the Permissions API.
 */
export function installMedia(opts: { noMediaDevices?: boolean; noPermissions?: boolean } = {}): InstalledMedia {
  const control: MediaControl = {
    nextStream: new FakeMediaStream(),
    nextError: null,
    calls: [],
    permissionStatuses: new Map(),
    rejectPermissionQuery: false,
    devices: [
      { deviceId: "cam-1", label: "Front Camera", groupId: "g1", kind: "videoinput" } as MediaDeviceInfo,
    ],
  };

  const nav = navigator as unknown as Record<string, unknown>;
  originals.mediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  originals.permissions = Object.getOwnPropertyDescriptor(navigator, "permissions");

  if (!opts.noMediaDevices) {
    const bus = new EventTarget();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: (constraints: MediaStreamConstraints): Promise<MediaStream> => {
          control.calls.push(constraints);
          if (control.nextError) {
            const err = control.nextError;
            return Promise.reject(Object.assign(new Error(err.message ?? err.name), { name: err.name }));
          }
          return Promise.resolve(control.nextStream as unknown as MediaStream);
        },
        enumerateDevices: (): Promise<MediaDeviceInfo[]> => Promise.resolve(control.devices),
        addEventListener: (t: string, fn: EventListener): void => bus.addEventListener(t, fn),
        removeEventListener: (t: string, fn: EventListener): void => bus.removeEventListener(t, fn),
        dispatchEvent: (e: Event): boolean => bus.dispatchEvent(e),
      },
    });
  } else {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  }

  if (!opts.noPermissions) {
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: (descriptor: { name: string }): Promise<PermissionStatus> => {
          if (control.rejectPermissionQuery) {
            return Promise.reject(new TypeError(`unsupported descriptor: ${descriptor.name}`));
          }
          let status = control.permissionStatuses.get(descriptor.name);
          if (!status) {
            status = new FakePermissionStatus("prompt");
            control.permissionStatuses.set(descriptor.name, status);
          }
          return Promise.resolve(status as unknown as PermissionStatus);
        },
      },
    });
  } else {
    Object.defineProperty(navigator, "permissions", { configurable: true, value: undefined });
  }

  void nav;

  return {
    control,
    resolveWith(stream: FakeMediaStream): void {
      control.nextStream = stream;
      control.nextError = null;
    },
    rejectWith(name: string, message?: string): void {
      control.nextError = { name, message };
    },
    setPermission(name: "camera" | "microphone", state: string): FakePermissionStatus {
      let status = control.permissionStatuses.get(name);
      if (!status) {
        status = new FakePermissionStatus(state);
        control.permissionStatuses.set(name, status);
      } else {
        status.state = state;
      }
      return status;
    },
    emitDeviceChange(): void {
      const md = navigator.mediaDevices as unknown as { dispatchEvent(e: Event): boolean };
      md.dispatchEvent(new Event("devicechange"));
    },
    uninstall(): void {
      restoreProp("mediaDevices", originals.mediaDevices);
      restoreProp("permissions", originals.permissions);
    },
  };
}

function restoreProp(name: string, descriptor: unknown): void {
  if (descriptor) {
    Object.defineProperty(navigator, name, descriptor as PropertyDescriptor);
  } else {
    delete (navigator as unknown as Record<string, unknown>)[name];
  }
}

// --- MediaRecorder fake ---

export class FakeMediaRecorder {
  static supportedTypes: string[] = ["video/webm"];
  static instances: FakeMediaRecorder[] = [];
  static throwOnConstruct = false;

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.includes(type);
  }

  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;

  constructor(public stream: MediaStream, public options: MediaRecorderOptions = {}) {
    if (FakeMediaRecorder.throwOnConstruct) {
      throw Object.assign(new Error("construct failed"), { name: "NotSupportedError" });
    }
    this.mimeType = options.mimeType ?? "video/webm";
    FakeMediaRecorder.instances.push(this);
  }

  start(_timeslice?: number): void { this.state = "recording"; }
  stop(): void {
    this.state = "inactive";
    if (this.onstop) this.onstop();
  }
  pause(): void { this.state = "paused"; if (this.onpause) this.onpause(); }
  resume(): void { this.state = "recording"; if (this.onresume) this.onresume(); }

  /** Push a data chunk to the recorder. */
  emitData(blob: Blob): void {
    if (this.ondataavailable) this.ondataavailable({ data: blob });
  }
  /** Raise a recorder error. */
  emitError(name: string): void {
    if (this.onerror) this.onerror(Object.assign(new Event("error"), { error: { name } }));
  }
}

const recorderOriginals: { MediaRecorder?: unknown; createObjectURL?: unknown; revokeObjectURL?: unknown } = {};
export const revokedUrls: string[] = [];
let urlSeq = 0;

/** Install a fake global MediaRecorder + URL.createObjectURL/revokeObjectURL. */
export function installRecorder(): { uninstall(): void } {
  const g = globalThis as unknown as Record<string, unknown>;
  recorderOriginals.MediaRecorder = g.MediaRecorder;
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.throwOnConstruct = false;
  FakeMediaRecorder.supportedTypes = ["video/webm"];
  g.MediaRecorder = FakeMediaRecorder;

  revokedUrls.length = 0;
  urlSeq = 0;
  recorderOriginals.createObjectURL = URL.createObjectURL;
  recorderOriginals.revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = ((): string => `blob:fake-${++urlSeq}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string): void => { revokedUrls.push(url); }) as typeof URL.revokeObjectURL;

  return {
    uninstall(): void {
      if (recorderOriginals.MediaRecorder === undefined) {
        delete g.MediaRecorder;
      } else {
        g.MediaRecorder = recorderOriginals.MediaRecorder;
      }
      URL.createObjectURL = recorderOriginals.createObjectURL as typeof URL.createObjectURL;
      URL.revokeObjectURL = recorderOriginals.revokeObjectURL as typeof URL.revokeObjectURL;
    },
  };
}

export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));
