// @ts-nocheck — the bodies are the author's stand-in scripts (examples/stamp-rally, tests/standins/*.js), kept as written
//
// The stamp-rally seam app's stand-ins, each a function for page.addInitScript(). The author wrote them as plain
// scripts loaded with addInitScript({ path }) and ran the iPhone one in WebKit. CI has Chromium and Firefox, so the
// iPhone stand-in runs in Chromium here, and what WebKit gave it for free is added, marked "(port)": Chromium's Generic
// Sensor classes are taken away — Safari has none, so <wcs-accelerometer> and <wcs-gyroscope> read `devicemotion` as
// on an iPhone — the events of the PC's own (absent) sensors are stopped before the page hears them, and the
// Permissions API does not know the sensor names, as Safari's does not.

/**
 * Stand-in: an iPhone's motion & orientation permission, the way Safari behaves.
 * - DeviceOrientationEvent / DeviceMotionEvent exist and have a static requestPermission().
 * - requestPermission() answers only when called with transient user activation (a tap); otherwise it rejects with
 *   NotAllowedError and nothing is asked.
 * - One answer covers both; the answer is remembered (also over a reload) and the question is not asked again;
 *   asked again, the remembered answer comes back at once, without a tap.
 * - No reading arrives before the permission is granted.
 * What it does NOT prove: the real Safari dialog, the real sensors, the iOS settings switch.
 */
export function iosSensors() {
  const KEY = "__standin_ios_answer";
  const S = (window.__standin = window.__standin ?? {});
  const ios = (S.ios = { asked: 0, rejectedNoGesture: 0, answer: "granted", listeners: 0 });
  const remembered = () => localStorage.getItem(KEY);
  const granted = () => remembered() === "granted";

  // (port) Safari has no Generic Sensor classes; Chromium's are taken away, and the events of the PC's own sensors
  // (Chromium sends one with every value null when a listener is added) are not an iPhone's.
  for (const name of ["Accelerometer", "Gyroscope", "Magnetometer", "AbsoluteOrientationSensor", "RelativeOrientationSensor"]) window[name] = undefined;
  for (const type of ["deviceorientation", "deviceorientationabsolute", "devicemotion"]) {
    window.addEventListener(type, (e) => { if (e.isTrusted) e.stopImmediatePropagation(); }, true);
  }
  // (port) Safari's Permissions API does not know the sensor names; Chromium's answers for them (and says "denied" in a
  // test context that granted only the position)
  const query = navigator.permissions?.query?.bind(navigator.permissions);
  if (query) {
    navigator.permissions.query = (d) => ["accelerometer", "gyroscope", "magnetometer", "ambient-light-sensor"].includes(d?.name)
      ? Promise.reject(new TypeError(`'${d.name}' is not a valid value for enumeration PermissionName.`))
      : query(d);
  }

  class FakeOrientationEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.alpha = init.alpha ?? null; this.beta = init.beta ?? null; this.gamma = init.gamma ?? null;
      this.absolute = false;
      this.webkitCompassHeading = init.webkitCompassHeading ?? undefined;
      this.webkitCompassAccuracy = init.webkitCompassHeading == null ? undefined : 10;
    }
  }
  class FakeMotionEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.accelerationIncludingGravity = init.accelerationIncludingGravity ?? null;
      this.acceleration = init.acceleration ?? null;
      this.rotationRate = init.rotationRate ?? null;
      this.interval = init.interval ?? 16;
    }
  }
  async function requestPermission() {
    // WebKit answers a question already decided without showing anything, tap or not (assumption, see README)
    if (remembered()) return remembered();
    if (!navigator.userActivation?.isActive) {
      ios.rejectedNoGesture++;
      throw new DOMException("Requesting device orientation or motion access requires a user gesture to prompt", "NotAllowedError");
    }
    ios.asked++;
    const answer = ios.answer;
    localStorage.setItem(KEY, answer);
    return answer;
  }
  FakeOrientationEvent.requestPermission = requestPermission;
  FakeMotionEvent.requestPermission = requestPermission;
  Object.defineProperty(window, "DeviceOrientationEvent", { value: FakeOrientationEvent, configurable: true, writable: true });
  Object.defineProperty(window, "DeviceMotionEvent", { value: FakeMotionEvent, configurable: true, writable: true });

  const add = window.addEventListener.bind(window);
  window.addEventListener = function (type, fn, opts) {
    if (type === "deviceorientation" || type === "devicemotion") ios.listeners++;
    return add(type, fn, opts);
  };
  const remove = window.removeEventListener.bind(window);
  window.removeEventListener = function (type, fn, opts) {
    if (type === "deviceorientation" || type === "devicemotion") ios.listeners--;
    return remove(type, fn, opts);
  };
  ios.feedOrientation = (init) => { if (granted()) window.dispatchEvent(new FakeOrientationEvent("deviceorientation", init)); return granted(); };
  ios.feedMotion = (init) => { if (granted()) window.dispatchEvent(new FakeMotionEvent("devicemotion", init)); return granted(); };
  ios.forget = () => localStorage.removeItem(KEY);
}

/**
 * Stand-ins for what only some browsers have: the share sheet, the contact picker, saved passwords, the eye dropper.
 * Each follows its specification's rules that a page can get wrong:
 *   - needs transient user activation (share: NotAllowedError; contacts: SecurityError; eye dropper: NotAllowedError),
 *   - a second call while the first is open is refused (InvalidStateError),
 *   - the user can close it without choosing (share/eye dropper: AbortError; contacts: resolves []),
 * and the test decides what the "user" does: window.__standin.<name>.mode = "complete" | "dismiss" | "manual".
 * What it does NOT prove: the real browser UI, OS share targets, a real password manager's heuristics.
 */
export function pickers() {
  const S = (window.__standin = window.__standin ?? {});
  const active = () => navigator.userActivation?.isActive === true;
  function surface(name) {
    const s = { mode: "complete", calls: [], open: false, refused: [], pending: null };
    s.finish = (how = "complete", value) => {
      const p = s.pending;
      if (!p) return false;
      s.pending = null; s.open = false;
      if (how === "complete") p.resolve(value ?? p.value);
      else p.reject(new DOMException("The user closed it.", "AbortError"));
      return true;
    };
    return (S[name] = s);
  }
  function run(s, value, errNoGesture, dismissValue) {
    if (!active()) { s.refused.push("no-activation"); return Promise.reject(new DOMException("Must be handling a user gesture.", errNoGesture)); }
    if (s.open) { s.refused.push("already-open"); return Promise.reject(new DOMException("Already open.", "InvalidStateError")); }
    s.open = true;
    return new Promise((resolve, reject) => {
      s.pending = { resolve, reject, value };
      const mode = s.mode;
      if (mode === "manual") return;
      setTimeout(() => {
        if (mode === "complete") s.finish("complete", value);
        else if (dismissValue !== undefined) { s.pending = null; s.open = false; resolve(dismissValue); }
        else s.finish("dismiss");
      }, s.delay ?? 50);
    });
  }

  // ---- Web Share
  const share = surface("share");
  share.files = true;
  navigator.share = function (data = {}) {
    share.calls.push({
      title: data.title, text: data.text, url: data.url,
      files: (data.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
      activation: active(),
    });
    if (data.files?.length && !share.files) return Promise.reject(new DOMException("Files not supported", "NotAllowedError"));
    // a frame whose embedder did not allow web-share (the stand-in cannot read the parent's allow attribute: the test says so)
    if (share.policyBlocked) return Promise.reject(new DOMException("Permission denied by permissions policy", "NotAllowedError"));
    return run(share, undefined, "NotAllowedError");
  };
  navigator.canShare = function (data = {}) {
    if (data.files?.length) return share.files && data.files.every((f) => /^image\//.test(f.type));
    return Boolean(data.title || data.text || data.url);
  };

  // ---- Contact Picker (closing without choosing resolves an empty array — spec §7)
  const contacts = surface("contacts");
  contacts.next = [];
  class ContactsManager {
    async getProperties() { return ["name", "email", "tel"]; }
    select(props, opts = {}) {
      contacts.calls.push({ props, multiple: !!opts.multiple, activation: active() });
      if (window.top !== window) return Promise.reject(new DOMException("Top-level only", "InvalidStateError"));
      return run(contacts, contacts.next, "SecurityError", []);
    }
  }
  window.ContactsManager = ContactsManager;
  Object.defineProperty(navigator, "contacts", { value: new ContactsManager(), configurable: true });

  // ---- EyeDropper
  const eye = surface("eyedropper");
  eye.next = "#123456";
  window.EyeDropper = class EyeDropper {
    open(opts = {}) {
      eye.calls.push({ activation: active() });
      const p = run(eye, { sRGBHex: eye.next }, "NotAllowedError");
      opts.signal?.addEventListener("abort", () => eye.finish("dismiss"));
      return p;
    }
  };

  // ---- Credential Management (password)
  const KEY = "__standin_saved_password";
  const creds = surface("credentials");
  creds.silentBlocked = () => localStorage.getItem(KEY + ":noSilent") === "1";
  creds.saved = () => JSON.parse(localStorage.getItem(KEY) ?? "null");
  creds.store = (id, password, name) => localStorage.setItem(KEY, JSON.stringify({ id, password, name }));
  creds.clear = () => { localStorage.removeItem(KEY); localStorage.removeItem(KEY + ":noSilent"); };
  creds.log = [];
  window.PasswordCredential = class PasswordCredential {
    constructor(init) {
      if (init instanceof HTMLFormElement) throw new TypeError("form not supported by the stand-in");
      if (!init?.id || !init?.password) throw new TypeError("id and password required");
      this.id = init.id; this.password = init.password; this.name = init.name ?? ""; this.type = "password";
    }
  };
  const credentials = {
    async get(opts = {}) {
      creds.log.push({ op: "get", mediation: opts.mediation ?? "optional", password: !!opts.password });
      if (window.top !== window) { try { void window.top.location.href; } catch { throw new DOMException("cross-origin frame", "NotAllowedError"); } }
      const saved = creds.saved();
      if (!opts.password || !saved) return null;
      if (opts.mediation === "silent") return creds.silentBlocked() ? null : new window.PasswordCredential(saved);
      return new window.PasswordCredential(saved);
    },
    async store(c) {
      creds.log.push({ op: "store", id: c?.id });
      if (c?.type === "password") { creds.store(c.id, c.password, c.name); localStorage.removeItem(KEY + ":noSilent"); }
      return c;
    },
    async preventSilentAccess() { creds.log.push({ op: "preventSilentAccess" }); localStorage.setItem(KEY + ":noSilent", "1"); },
    async create() { return null; },
  };
  Object.defineProperty(navigator, "credentials", { value: credentials, configurable: true });
}
