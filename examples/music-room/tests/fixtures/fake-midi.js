// A stand-in for the browser's Web MIDI API, injected with page.addInitScript() before any page
// script runs. There is no MIDI device on the test machine, so this fakes navigator.requestMIDIAccess,
// MIDIAccess (inputs / outputs maps, statechange), MIDIInput (midimessage), MIDIOutput (send) and
// navigator.permissions.query({ name: "midi" }). Tests drive it through window.__midi.
(() => {
  const cfg = Object.assign({ permission: "granted", devices: [] }, window.__midiConfig ?? {});

  class FakeEvent extends Event {
    constructor(type, props) { super(type); Object.assign(this, props); }
  }

  class FakePort extends EventTarget {
    constructor(id, name, type, manufacturer = "Test") {
      super();
      this.id = id; this.name = name; this.type = type; this.manufacturer = manufacturer;
      this.version = "1.0"; this.state = "connected"; this.connection = "closed";
      this._onmidimessage = null; this.onstatechange = null;
      this.sent = [];
    }
    open() { this.connection = "open"; return Promise.resolve(this); }
    close() { this.connection = "closed"; return Promise.resolve(this); }
    get onmidimessage() { return this._onmidimessage; }
    set onmidimessage(fn) { this._onmidimessage = fn; if (fn) this.connection = "open"; }
    send(data, timestamp) {
      if (this.state !== "connected") throw new DOMException("port disconnected", "InvalidStateError");
      this.sent.push(Array.from(data));
    }
    clear() {}
    _receive(bytes) {
      const ev = new FakeEvent("midimessage", { data: new Uint8Array(bytes), receivedTime: performance.now() });
      this.dispatchEvent(ev);
      this._onmidimessage?.call(this, ev);
    }
  }

  class FakeAccess extends EventTarget {
    constructor() { super(); this.inputs = new Map(); this.outputs = new Map(); this.onstatechange = null; this.sysexEnabled = false; }
    _statechange(port) {
      const ev = new FakeEvent("statechange", { port });
      this.dispatchEvent(ev);
      this.onstatechange?.call(this, ev);
      port.dispatchEvent(new FakeEvent("statechange", { port }));
    }
  }

  const access = new FakeAccess();
  const listeners = new Set();
  const permStatus = new EventTarget();
  let permission = cfg.permission;
  Object.defineProperty(permStatus, "state", { get: () => permission });
  Object.defineProperty(permStatus, "name", { value: "midi" });
  permStatus.onchange = null;
  const setPermission = (p) => {
    permission = p;
    permStatus.dispatchEvent(new Event("change"));
    permStatus.onchange?.call(permStatus, new Event("change"));
  };

  const plug = ({ id, name, type = "input", manufacturer }) => {
    const map = type === "input" ? access.inputs : access.outputs;
    let port = map.get(id);
    if (port) port.state = "connected";
    else { port = new FakePort(id, name, type, manufacturer); map.set(id, port); }
    access._statechange(port);
    return port;
  };
  for (const d of cfg.devices) plug(d);

  let requests = 0;
  const realQuery = navigator.permissions?.query?.bind(navigator.permissions);
  if (navigator.permissions) {
    navigator.permissions.query = (desc) => (desc?.name === "midi" ? Promise.resolve(permStatus) : realQuery(desc));
  }
  navigator.requestMIDIAccess = (opts) => {
    requests += 1;
    if (permission === "prompt") permission = cfg.answer ?? "granted"; // the user answers the prompt
    if (permission === "denied") return Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    setPermission("granted");
    return Promise.resolve(access);
  };

  window.__midi = {
    access,
    get requests() { return requests; },
    plug,
    unplug(id) {
      const port = access.inputs.get(id) ?? access.outputs.get(id);
      if (!port) return;
      port.state = "disconnected";
      port.connection = "closed";
      access._statechange(port);
    },
    /** Send raw bytes from an input port, as the keyboard would. */
    send(id, bytes) { access.inputs.get(id)?._receive(bytes); },
    noteOn(id, note, velocity = 100, channel = 1) { this.send(id, [0x90 + channel - 1, note, velocity]); },
    noteOff(id, note, channel = 1) { this.send(id, [0x80 + channel - 1, note, 0]); },
    cc(id, control, value, channel = 1) { this.send(id, [0xb0 + channel - 1, control, value]); },
    bend(id, value14, channel = 1) { this.send(id, [0xe0 + channel - 1, value14 & 0x7f, (value14 >> 7) & 0x7f]); },
    sent(id) { return access.outputs.get(id)?.sent ?? []; },
    setPermission,
    setAnswer(p) { cfg.answer = p; },
  };
})();
