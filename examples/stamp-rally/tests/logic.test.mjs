import { describe, it, expect } from "vitest";
import {
  distanceM, bearingDeg, compass8, directionText, screenHeading, arrowRotation, createShakeDetector,
  createStepCounter, magneticDisturbed, nextLightLevel, themeFor, dragAngle, turnAngle, wrapAngle, mergeContacts,
  lineStatus, nextSpot, safeNext, formatDistance,
} from "../public/js/logic.js";
import { detectCaps, availability } from "../public/js/caps.js";

const A = { lat: 36.434, lng: 139.2778 };

describe("bearing and distance to a place", () => {
  it("due north / east / south-west", () => {
    expect(Math.round(bearingDeg(A, { lat: 36.4362, lng: 139.2778 }))).toBe(0);
    expect(Math.round(bearingDeg(A, { lat: 36.434, lng: 139.29 }))).toBe(90);
    expect(compass8(bearingDeg(A, { lat: 36.43, lng: 139.27 }))).toBe("南西");
  });
  it("distance in metres, formatted", () => {
    const d = distanceM(A, { lat: 36.4362, lng: 139.2778 });
    expect(d).toBeGreaterThan(240);
    expect(d).toBeLessThan(250);
    expect(formatDistance(d)).toBe("240 m");
    expect(formatDistance(1234)).toBe("1.2 km");
    expect(directionText(45, 240)).toBe("北東へ 240 m");
    expect(distanceM(null, A)).toBe(null);
  });
  it("wraps across 360", () => {
    expect(wrapAngle(-10)).toBe(350);
    expect(wrapAngle(725)).toBe(5);
    expect(compass8(359)).toBe("北");
  });
});

describe("north: the device's heading turned into the screen's", () => {
  // <wcs-tilt>'s `heading` is the device's top edge (webkitCompassHeading, deviceorientationabsolute); the page adds
  // the screen's angle
  it("upright, and with the screen turned to landscape", () => {
    expect(screenHeading(90)).toBe(90);
    expect(screenHeading(350, 90)).toBe(80);
    expect(screenHeading(270, 90)).toBe(0);
  });
  it("no heading from the device: north unknown", () => {
    expect(screenHeading(null)).toBe(null);
    expect(screenHeading(undefined, 90)).toBe(null);
    expect(screenHeading(NaN)).toBe(null);
    expect(screenHeading(10, NaN)).toBe(10);
  });
  it("the arrow: ahead, left, behind", () => {
    expect(arrowRotation(0, 0)).toBe(0);
    expect(arrowRotation(0, 90)).toBe(270);
    expect(arrowRotation(0, 180)).toBe(180);
    expect(arrowRotation(null, 10)).toBe(null);
  });
});

describe("the shake detector", () => {
  const feed = (d, list, t0 = 0, dt = 90) => list.map((z, i) => d.push(0, 0, z, t0 + i * dt));
  it("three peaks within a second → one shake", () => {
    const d = createShakeDetector();
    expect(feed(d, [9.8, 26, 9.8, 26, 9.8, 26, 9.8]).filter(Boolean)).toHaveLength(1);
  });
  it("shaking on during the cooldown reports nothing", () => {
    const d = createShakeDetector();
    feed(d, [9.8, 26, 9.8, 26, 9.8, 26, 9.8]);
    expect(feed(d, [26, 9.8, 26, 9.8, 26, 9.8], 700).filter(Boolean)).toHaveLength(0);
  });
  it("peaks spread over more than a second are not a shake; nulls are ignored", () => {
    const d = createShakeDetector();
    expect(feed(d, [26, 9.8, 26, 9.8, 26], 0, 400).filter(Boolean)).toHaveLength(0);
    expect(d.push(null, null, null, 0)).toBe(false);
  });
});

describe("the step counter", () => {
  const STEP = [9.8, 11.5, 12.8, 11.5, 9.8, 8.4, 7.8, 8.4];
  it("counts one per swing", () => {
    const c = createStepCounter();
    let n = 0, t = 0;
    for (let i = 0; i < 6; i++) for (const z of STEP) { n += c.push(0, 0, z, t); t += 80; }
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(6);
  });
  it("ignores standing still and a shake", () => {
    const c = createStepCounter();
    let n = 0;
    for (let t = 0; t < 2000; t += 50) n += c.push(0.1, 0.2, 9.8, t);
    for (let t = 2000; t < 2600; t += 50) n += c.push(0, 0, t % 100 ? 25 : 9.8, t);
    expect(n).toBe(0);
  });
});

describe("the light limits", () => {
  it("bright, dark, and no flicker around a limit", () => {
    let lvl = null;
    const seq = [500, 30000, 19000, 21000, 15000, 9000, 5, 30, 8, 60];
    const out = seq.map((lux) => (lvl = nextLightLevel(lvl, lux)));
    expect(out).toEqual(["normal", "bright", "bright", "bright", "bright", "normal", "dark", "dark", "dark", "normal"]);
    expect(nextLightLevel("bright", NaN)).toBe("bright");
  });
  it("the theme: the switch wins, then the sensor, then the system", () => {
    expect(themeFor({ override: "dark", lightLevel: "bright" })).toBe("dark");
    expect(themeFor({ lightLevel: "bright" })).toBe("contrast");
    expect(themeFor({ lightLevel: "dark" })).toBe("dark");
    expect(themeFor({ prefersDark: true })).toBe("dark");
    expect(themeFor({ prefersContrast: true })).toBe("contrast");
    expect(themeFor({})).toBe("light");
  });
  it("magnetic field outside 25–65 µT, with a margin to switch back", () => {
    expect(magneticDisturbed(45)).toBe(false);
    expect(magneticDisturbed(80)).toBe(true);
    expect(magneticDisturbed(63, true)).toBe(true);
    expect(magneticDisturbed(60, true)).toBe(false);
  });
});

describe("the viewer's angle and its wrap", () => {
  it("dragging left looks right, and wraps", () => {
    expect(dragAngle(0, -100, 300)).toBeCloseTo(20, 5); // 1800 px per 360°
    expect(dragAngle(10, 100, 300)).toBeCloseTo(350, 5);
  });
  it("turning the phone follows the yaw change across 0/360", () => {
    expect(turnAngle(100, 10, 20)).toBe(90);
    expect(turnAngle(5, 355, 5)).toBe(355);
    expect(turnAngle(30, null, 5)).toBe(30);
  });
});

describe("merging contacts into members", () => {
  it("skips an address already there (any case), keeps a contact without a name, caps at 5", () => {
    const r = mergeContacts([{ name: "花子", email: "hanako@example.jp" }], [
      { name: ["Hanako"], email: ["HANAKO@example.jp"] },
      { name: [], email: ["taro@example.jp"] },
      { name: ["名前だけ"], email: [] },
      { name: [], email: [] },
    ]);
    expect(r.members).toEqual([
      { name: "花子", email: "hanako@example.jp" },
      { name: "taro", email: "taro@example.jp" },
      { name: "名前だけ", email: "" },
    ]);
    expect(r).toMatchObject({ added: 2, duplicates: 1, overflow: 0 });
    const many = Array.from({ length: 7 }, (_, i) => ({ name: [`p${i}`], email: [`p${i}@x.jp`] }));
    expect(mergeContacts([], many)).toMatchObject({ added: 5, overflow: 2 });
    expect(mergeContacts([], null).members).toEqual([]);
  });
});

describe("the device check", () => {
  it("five different answers", () => {
    expect(lineStatus({ supported: false })).toBe("none");
    expect(lineStatus({ supported: true, policy: false })).toBe("policy");
    expect(lineStatus({ supported: true, permission: "denied" })).toBe("denied");
    expect(lineStatus({ supported: true, permission: "prompt" })).toBe("prompt");
    expect(lineStatus({ supported: true, readings: "none" })).toBe("none");
    expect(lineStatus({ supported: true, readings: "unknown" })).toBe("checking");
    expect(lineStatus({ supported: true, failed: "policy" })).toBe("policy");
    expect(lineStatus({ supported: true })).toBe("ok");
  });
  it("forbidden by the page vs not in this browser, from what the element says", () => {
    // the element's `supported` and the browser has the API: usable
    expect(lineStatus(availability({ supported: true, api: true }))).toBe("ok");
    // the browser has the API and the element says the page cannot use it: the page it is in forbids it
    expect(lineStatus(availability({ supported: false, api: true }))).toBe("policy");
    // no API: not in this browser
    expect(lineStatus(availability({ supported: false, api: false }))).toBe("none");
    // where the page does not know the API, `supported: false` reads as not in this browser…
    expect(lineStatus(availability({ supported: false }))).toBe("none");
    // …unless <wcs-permission> said "policy-blocked"
    expect(lineStatus(availability({ supported: false, policyBlocked: true }))).toBe("policy");
    // forbidden, and not in this browser either (Chromium's Magnetometer is behind a flag): a new tab would not help
    expect(lineStatus(availability({ supported: false, api: false, policyBlocked: true }))).toBe("none");
  });
  it("caps: what no element says — the API, a frame, the iPhone's question", () => {
    const base = (extra = {}) => ({
      document: { pictureInPictureEnabled: false }, navigator: { share() {} },
      Element: { prototype: { requestFullscreen() {} } }, DeviceOrientationEvent: function () {}, screen: {}, ...extra,
    });
    const w1 = base();
    w1.top = w1; w1.self = w1;
    const c1 = detectCaps(w1);
    expect(c1).toMatchObject({ ios: false, framed: false, crossOriginFrame: false });
    expect(c1.api).toEqual({ fullscreen: true, orientationLock: false, pip: true, share: true, contacts: false, clipboard: false, magnetometer: false });
    // an iPhone: the event classes ask
    const asking = function () {};
    asking.requestPermission = () => Promise.resolve("granted");
    const w2 = base({ DeviceOrientationEvent: asking, navigator: {}, document: {} });
    w2.top = w2; w2.self = w2;
    expect(detectCaps(w2)).toMatchObject({ ios: true, api: { pip: false, share: false } });
    // a frame of another origin: reading its top's location throws
    const w3 = base();
    w3.self = w3;
    w3.top = { get location() { throw new Error("cross-origin"); } };
    expect(detectCaps(w3)).toMatchObject({ framed: true, crossOriginFrame: true });
  });
});

describe("misc", () => {
  it("the next place and a safe next", () => {
    const spots = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(nextSpot(spots, [{ spotId: 1 }]).id).toBe(2);
    expect(nextSpot(spots, [{ spotId: 1 }, { spotId: 2 }, { spotId: 3 }])).toBe(null);
    expect(safeNext("/card")).toBe("/card");
    expect(safeNext("//evil.example")).toBe("/walk");
    expect(safeNext("https://evil.example")).toBe("/walk");
  });
});
