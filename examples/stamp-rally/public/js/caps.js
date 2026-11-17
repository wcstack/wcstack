// The parts of 端末のチェック that no element says, and how a line is put together from what the elements say.
//
// The elements say most of it, and the state binds it:
// - each element's `supported` — whether this page can use the feature: the API is there and no Permissions-Policy
//   (the server's header, an <iframe> without `allow`) forbids it. So `false` is both "not in this browser" and
//   "forbidden by the page";
// - <wcs-permission>'s `unsupportedReason` — `"policy-blocked"` when the page it is in forbids a feature, where the
//   browser lets a page read its policy (Chromium): the sensors and the clipboard here;
// - <wcs-tilt>'s and <wcs-accelerometer>'s `permissionState` — the iPhone's answers.
//
// Left to the page (detectCaps):
// - whether the browser has the API at all, for the lines whose element cannot say why it is unsupported —
//   fullscreen, the orientation lock, Picture-in-Picture, the share sheet, the contact picker. With it, `supported:
//   false` in a browser that has the API is "forbidden by the page": the only way to say so in Firefox and WebKit,
//   which let a page read no policy. (<wcs-screen-orientation>'s `supported` says the screen can be watched, not
//   that `lock()` exists, and <wcs-clipboard> has no `supported`.)
// - whether Chromium has the Magnetometer class at all (it is behind a flag, while the policy knows `magnetometer`): in
//   a frame that forbids it and a browser that lacks it, the line says "not on this device" — a new tab would not help,
//   and no element says both;
// - whether the page is in a frame, and of another origin: no saved password is offered to one;
// - whether the browser asks the iPhone's question (a requestPermission() on the event classes), which decides the
//   advice and that the sensors wait for the answer.

/** @param {any} w a window (or a stand-in object in unit tests) */
export function detectCaps(w = globalThis) {
  const d = w.document ?? {};
  const nav = w.navigator ?? {};
  let framed = false, crossOriginFrame = false;
  try { framed = w.top !== w.self; } catch { framed = true; }
  if (framed) {
    try { void w.top.location.href; } catch { crossOriginFrame = true; }
  }
  const ios = typeof w.DeviceOrientationEvent?.requestPermission === "function" ||
    typeof w.DeviceMotionEvent?.requestPermission === "function";
  const elProto = w.Element?.prototype ?? {};
  const hasFs = typeof elProto.requestFullscreen === "function" || typeof elProto.webkitRequestFullscreen === "function";

  return {
    ios,
    framed,
    crossOriginFrame,
    /** The browser has the API (whether or not this page may use it). */
    api: {
      fullscreen: hasFs,
      orientationLock: typeof w.screen?.orientation?.lock === "function",
      // `in`, not a read: Chromium logs an error for reading pictureInPictureEnabled where the policy forbids it
      pip: "pictureInPictureEnabled" in d,
      share: typeof nav.share === "function",
      contacts: typeof nav.contacts?.select === "function",
      clipboard: typeof nav.clipboard?.writeText === "function",
      magnetometer: typeof w.Magnetometer === "function",
    },
  };
}

/**
 * A line's `supported` / `policy` for lineStatus(), from what an element says and what the page knows.
 * `supported`: the element's output. `api`: whether the browser has the API, where the page knows it — no API is
 * "not in this browser" first, as a new tab would not help; without it, `supported: false` reads as "not in this
 * browser". `policyBlocked`: <wcs-permission> said "policy-blocked".
 */
export function availability({ supported, api, policyBlocked = false } = {}) {
  if (api === false) return { supported: false, policy: true };
  if (policyBlocked) return { supported: true, policy: false };
  if (supported) return { supported: true, policy: true };
  return api ? { supported: true, policy: false } : { supported: false, policy: true };
}
