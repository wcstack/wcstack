// Pure logic of the stamp rally — no DOM, no wcstack. Unit-tested in tests/logic.test.mjs.

// ------------------------------------------------------------------ geography
const R = 6371000;
const rad = Math.PI / 180;

/** Great-circle distance in metres. */
export function distanceM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b, degrees clockwise from true north, [0, 360). */
export function bearingDeg(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const φ1 = a.lat * rad, φ2 = b.lat * rad, Δλ = (b.lng - a.lng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return wrapAngle(Math.atan2(y, x) / rad);
}

export function wrapAngle(deg) {
  if (deg == null || !Number.isFinite(deg)) return null;
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

const POINTS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
export function compass8(deg) {
  const d = wrapAngle(deg);
  return d == null ? "" : POINTS[Math.round(d / 45) % 8];
}

export function formatDistance(m) {
  if (m == null) return "";
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** "北東へ 240 m" */
export function directionText(bearing, distance) {
  if (bearing == null || distance == null) return "";
  return `${compass8(bearing)}へ ${formatDistance(distance)}`;
}

// ------------------------------------------------------------------ north
/**
 * The compass heading of the top of the *screen*. `deviceHeading` is <wcs-tilt>'s `heading` — degrees clockwise
 * from north of the device's top edge (from `webkitCompassHeading` on iOS Safari, `deviceorientationabsolute` on
 * Android Chrome), or null when the device has not said. The element does not correct it for the screen's rotation:
 * `screenAngle` (screen.orientation.angle) turns it into the screen's heading.
 */
export function screenHeading(deviceHeading, screenAngle = 0) {
  if (typeof deviceHeading !== "number" || !Number.isFinite(deviceHeading)) return null;
  const angle = Number.isFinite(screenAngle) ? screenAngle : 0;
  return wrapAngle(deviceHeading + angle);
}

/** Rotation of an arrow (0 = straight up the screen) that points from the user towards `bearing`. */
export function arrowRotation(bearing, heading) {
  if (bearing == null || heading == null) return null;
  return wrapAngle(bearing - heading);
}

/** Smallest absolute difference between two angles. */
export function angleDelta(a, b) {
  if (a == null || b == null) return Infinity;
  const d = Math.abs(wrapAngle(a) - wrapAngle(b));
  return d > 180 ? 360 - d : d;
}

// ------------------------------------------------------------------ motion
const G = 9.80665;
function magnitude(x, y, z) {
  if (![x, y, z].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Shake = `count` peaks of |a| above `threshold` m/s² within `windowMs`. After a shake nothing is reported for
 * `cooldownMs`, and a new shake needs the acceleration to fall back below `threshold` first.
 */
export function createShakeDetector({ threshold = 2 * G, count = 3, windowMs = 1000, cooldownMs = 1500 } = {}) {
  let above = false, peaks = [], quietUntil = 0;
  return {
    push(x, y, z, t) {
      const m = magnitude(x, y, z);
      if (m == null) return false;
      if (t < quietUntil) { above = m > threshold; return false; }
      if (m > threshold && !above) {
        above = true;
        peaks = peaks.filter((p) => t - p <= windowMs).concat(t);
        if (peaks.length >= count) { peaks = []; quietUntil = t + cooldownMs; return true; }
      } else if (m <= threshold * 0.8) {
        above = false;
      }
      return false;
    },
    reset() { above = false; peaks = []; quietUntil = 0; },
  };
}

/**
 * A simple peak counter: a step is |a| rising above `high` after having been below `low`, at most one per
 * `minIntervalMs`. Readings of more than `maxPlausible` (a shake) are ignored.
 */
export function createStepCounter({ high = 11.2, low = 9.6, minIntervalMs = 280, maxPlausible = 17 } = {}) {
  let armed = false, last = -Infinity, smooth = null;
  return {
    push(x, y, z, t) {
      const m = magnitude(x, y, z);
      if (m == null) return 0;
      if (m > maxPlausible) { armed = false; return 0; }
      smooth = smooth == null ? m : smooth * 0.4 + m * 0.6;
      if (smooth < low) armed = true;
      if (armed && smooth > high && t - last >= minIntervalMs) { armed = false; last = t; return 1; }
      return 0;
    },
    reset() { armed = false; last = -Infinity; smooth = null; },
  };
}

// ------------------------------------------------------------------ magnetic field
export const MAG_LOW = 25, MAG_HIGH = 65;
export function magneticStrength(x, y, z) { return magnitude(x, y, z); }
/** Disturbed when the (smoothed) strength is far outside the usual 25–65 µT. */
export function magneticDisturbed(strength, prev = false) {
  if (strength == null) return false;
  // a little hysteresis so the warning does not blink at the edge
  if (prev) return strength < MAG_LOW + 3 || strength > MAG_HIGH - 3;
  return strength < MAG_LOW || strength > MAG_HIGH;
}

// ------------------------------------------------------------------ light
export const LIGHT = { brightOn: 20000, brightOff: 10000, darkOn: 10, darkOff: 50 };
/** Light level with hysteresis: "bright" (full sun) / "dark" (dusk) / "normal". */
export function nextLightLevel(prev, lux, limits = LIGHT) {
  if (typeof lux !== "number" || !Number.isFinite(lux)) return prev ?? "normal";
  if (prev === "bright") return lux < limits.brightOff ? (lux <= limits.darkOn ? "dark" : "normal") : "bright";
  if (prev === "dark") return lux > limits.darkOff ? (lux >= limits.brightOn ? "bright" : "normal") : "dark";
  if (lux >= limits.brightOn) return "bright";
  if (lux <= limits.darkOn) return "dark";
  return "normal";
}

/** The theme shown: the switch wins; on 自動, the light sensor if it has a reading, else the system setting. */
export function themeFor({ override = "auto", lightLevel = null, prefersDark = false, prefersContrast = false } = {}) {
  if (override === "light" || override === "dark" || override === "contrast") return override;
  if (lightLevel === "bright") return "contrast";
  if (lightLevel === "dark") return "dark";
  if (lightLevel === "normal") return "light";
  if (prefersContrast) return "contrast";
  return prefersDark ? "dark" : "light";
}

// ------------------------------------------------------------------ viewer
export const STRIP_ASPECT = 6; // the panorama is 3600 × 600
/** New view angle after a horizontal drag/mouse move of `dxPx` on a viewer `heightPx` tall. */
export function dragAngle(startAngle, dxPx, heightPx) {
  const pxPerDeg = (heightPx * STRIP_ASPECT) / 360;
  return wrapAngle(startAngle - dxPx / (pxPerDeg || 1));
}
/** Turning the phone left (alpha grows) looks left: the view angle follows the yaw change. */
export function turnAngle(viewAngle, yawPrev, yawNow) {
  if (yawPrev == null || yawNow == null) return wrapAngle(viewAngle);
  let d = yawNow - yawPrev;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return wrapAngle(viewAngle - d);
}

// ------------------------------------------------------------------ contacts → members
export const MAX_MEMBERS = 5;
const norm = (email) => String(email ?? "").trim().toLowerCase();
/**
 * Merge what the contact picker returned (`[{ name: string[], email: string[], … }]`) into the members list.
 * The same e-mail address is not added twice; a contact without a name or an address is still usable.
 */
export function mergeContacts(members, contacts, max = MAX_MEMBERS) {
  const out = members.map((m) => ({ name: m.name ?? "", email: m.email ?? "" }));
  const seen = new Set(out.map((m) => norm(m.email)).filter(Boolean));
  let added = 0, duplicates = 0, overflow = 0;
  for (const c of Array.isArray(contacts) ? contacts : []) {
    const name = (Array.isArray(c?.name) ? c.name : [c?.name]).find((n) => typeof n === "string" && n.trim()) ?? "";
    const email = (Array.isArray(c?.email) ? c.email : [c?.email]).find((e) => typeof e === "string" && e.trim()) ?? "";
    if (!name && !email) continue;
    const key = norm(email);
    if (key && seen.has(key)) { duplicates++; continue; }
    if (out.length >= max) { overflow++; continue; }
    out.push({ name: name.trim() || email.split("@")[0], email: email.trim() });
    if (key) seen.add(key);
    added++;
  }
  return { members: out, added, duplicates, overflow };
}

// ------------------------------------------------------------------ device check
export const STATUS_TEXT = {
  ok: "使えます",
  prompt: "許可が必要です",
  denied: "許可されていません",
  policy: "このページでは使えません",
  none: "この端末では使えません",
  checking: "確認中…",
};

/**
 * One line's status from what the page knows now.
 * `supported`: the browser has the API (false → none). `policy`: false when the embedding page / header forbids it.
 * `permission`: "granted" | "denied" | "prompt" | null (no permission concept or unknown).
 * `readings`: "yes" | "none" | "unknown" — learnt once a sensor ran. `failed`: a call that showed the device cannot.
 */
export function lineStatus({ supported, policy = true, permission = null, readings = "yes", failed = null } = {}) {
  if (!supported) return "none";
  if (policy === false) return "policy";
  if (failed === "policy") return "policy";
  if (permission === "denied" || failed === "denied") return "denied";
  if (permission === "prompt") return "prompt";
  if (failed === "none" || readings === "none") return "none";
  if (readings === "unknown") return "checking";
  return "ok";
}

/** Advice shown under a line. */
export function lineAdvice(status, { ios = false, framed = false } = {}) {
  switch (status) {
    case "denied":
      return ios
        ? "Safari は二度目を聞きません。設定アプリ →「Safari」→「モーションと画面の向きのアクセス」をオンにして、このページを開き直してください。"
        : "アドレスバーの鍵のマーク（サイトの設定）から許可して、このページを読み込み直してください。";
    case "policy":
      return framed ? "このページの中では使えません。「新しいタブで開く」から開いてください。" : "このページの設定で止められています。";
    case "prompt":
      return "「許可する」を押すと、ブラウザが確認します。";
    case "none":
      return "ほかの方法で参加できます。";
    default:
      return "";
  }
}

// ------------------------------------------------------------------ misc
export function nextSpot(spots, stamps) {
  const done = new Set((stamps ?? []).map((s) => s.spotId));
  return (spots ?? []).find((s) => !done.has(s.id)) ?? null;
}

export function safeNext(next) {
  if (typeof next !== "string" || !next.startsWith("/")) return "/walk";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/walk";
  return next;
}
