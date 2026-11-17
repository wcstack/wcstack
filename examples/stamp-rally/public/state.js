// State of みどり市 まち歩きスタンプラリー (one root <wcs-state src="state.js">).
import {
  distanceM, bearingDeg, arrowRotation, directionText, formatDistance, screenHeading, angleDelta,
  createShakeDetector, createStepCounter, magneticStrength, magneticDisturbed, nextLightLevel, themeFor,
  dragAngle, turnAngle, wrapAngle, mergeContacts, lineStatus, lineAdvice, STATUS_TEXT, nextSpot, safeNext, MAX_MEMBERS,
} from "./js/logic.js";
import { detectCaps, availability } from "./js/caps.js";
import { silentSignIn } from "./js/auth.js";

// ---------------------------------------------------------------- outside state (not reactive on purpose)
// Sensor readings arrive tens of times a second. They are handled here, in plain objects, and only what the page
// shows is written into state — and only when it changed (docs/device-apis.md, "Sensors that keep running").
const shake = createShakeDetector();
const stepper = createStepCounter();
const mag = { smooth: null };
const yaw = { tilt: null, gyroT: null };
let cardFile = null;          // the PNG of the stamp card, made before the user taps 共有
let cardMaking = 0;
// Counters a test (and the long-walk measurement) reads: how many readings each handler actually processed.
const stats = (globalThis.__srStats = globalThis.__srStats ?? {
  handled: { tilt: 0, heading: 0, accel: 0, gyro: 0, mag: 0, light: 0 }, starts: [], stops: [],
});

const SWATCHES = ["#2e7d32", "#f9a825", "#c62828", "#1565c0", "#6a1b9a", "#ef6c00", "#00838f", "#5d4037"];
const SENSORS = ["tilt", "accel", "gyro", "mag", "light", "geo"];
const SENSOR_LINES = ["orientation", "motion", "gyroscope"];
const CHECK = [
  ["orientation", "向きのセンサー"], ["motion", "動きのセンサー"], ["gyroscope", "回転のセンサー"],
  ["magnetometer", "磁気のセンサー"], ["light", "明るさのセンサー"], ["fullscreen", "全画面表示"],
  ["orientationLock", "画面の向きの固定"], ["pip", "小窓の動画"], ["share", "共有"], ["contacts", "連絡先"],
  ["eyedropper", "色を拾う"], ["password", "パスワードの保存"],
];
const iosPerm = (p) => (p === "granted" ? "granted" : p === "denied" ? "denied" : "prompt");
const webPerm = (p) => (p === "granted" || p === "denied" || p === "prompt" ? p : null);
const errCode = (info) => info?.code ?? null;
const sensorFail = (info) => {
  const c = errCode(info);
  if (!c) return null;
  if (c === "not-allowed") return "denied";
  return "none";
};
function parseBody(err) {
  try { return JSON.parse(err?.body ?? "{}"); } catch { return {}; }
}

/** @typedef {{ id: number, name: string, kana: string, lat: number, lng: number, story: string, panorama: string, video: string }} Spot */
/** @typedef {{ spotId: number, at: string }} Stamp */
/** @typedef {{ name: string, email: string }} Member */

export default {
  // ============================================================ router
  path: "",
  routeName: "",
  /** @type {{ id?: number }} */
  routeParams: {},
  /** @type {{ next?: string }} */
  query: {},
  /** @type {{ signedInSilently?: { token: string, participant: { number: string, name: string } } } | null} */
  routeData: null,
  navigateUrl: null,
  replaceUrl: null,

  // ============================================================ what the browser has (decided once: it cannot change)
  /** @type {any} */
  caps: null,
  apiQ: "",
  pageVisible: true,
  get framed() { return this["caps.framed"] === true; },
  get newTabUrl() { return location.origin + this.path; },

  // ============================================================ session
  /** @type {{ token: string, participant: { number: string, name: string } } | null} */
  session: null,
  get token() { return this["session.token"] ?? ""; },
  get loggedIn() { return this.token !== ""; },
  get participantNumber() { return this["session.participant.number"] ?? ""; },
  get participantName() { return this["session.participant.name"] ?? ""; },
  get authHeader() { return this.loggedIn ? "Bearer " + this.token : null; },
  sessionEndReason: "",
  notice: "",
  liveMessage: "",

  loginForm: { number: "", phrase: "" },
  loginBody: null,
  loginTrigger: false,
  loginLoading: false,
  loginError: null,
  get loginErrorMessage() {
    const e = this.loginError;
    if (!e) return "";
    return parseBody(e).error ?? "サインインできませんでした。";
  },
  login() {
    this.loginBody = { number: this["loginForm.number"].trim(), phrase: this["loginForm.phrase"] };
    this.loginTrigger = true;
  },
  logoutTrigger: false,
  logout() {
    // the trigger first: it sends the Authorization header the element has now (router-auth example)
    this.logoutTrigger = true;
    this.sessionEndReason = "logout";
    this.session = null;
    // the browser does not sign this user back in silently on the next visit
    this.$command.credSignOut.emit();
  },
  /** @type {any} */
  credStoreError: null,

  // ============================================================ me + places
  /** @type {{ value: { participant: any, team: any, stamps: Stamp[] } | null, loading: boolean, error: any, status: number }} */
  meFetch: { value: null, loading: false, error: null, status: 0 },
  meReload: false,
  get meUrl() { return this.loggedIn ? "/api/me" + this.apiQ : null; },
  /** @type {Spot[] | null} */
  spotsValue: null,
  spotsError: null,
  // every API request carries ?delay= when the page was opened with it (the slow-server check)
  get loginUrl() { return "/api/login" + this.apiQ; },
  get logoutUrl() { return "/api/logout" + this.apiQ; },
  get teamUrl() { return "/api/team" + this.apiQ; },
  get stampUrl() { return "/api/stamps" + this.apiQ; },
  get spotsUrl() { return "/api/spots" + this.apiQ; },
  get spots() { return this.spotsValue ?? []; },
  /** @type {Stamp[]} */
  stamps: [],
  /** @type {{ name: string, color: string, members: Member[] } | null} */
  team: null,
  get stampedIds() { return this.stamps.map((s) => s.spotId); },
  get stampCount() { return this.stamps.length; },
  get stampLabel() { return `${this.stampCount} / ${this.spots.length || 8}`; },
  get teamName() { return this["team.name"] ?? ""; },
  get teamColor() { return this["team.color"] ?? "#cccccc"; },
  get hasTeam() { return this.team != null; },
  get "spots.*.stamped"() { return this.stampedIds.includes(this["spots.*.id"]); },
  get "spots.*.href"() { return "/spots/" + this["spots.*.id"]; },
  get "spots.*.stampedAt"() {
    const s = this.stamps.find((x) => x.spotId === this["spots.*.id"]);
    return s ? new Date(s.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  },
  get allStamped() { return this.spots.length > 0 && this.stampCount >= this.spots.length; },

  // ============================================================ 端末のチェック
  // What the elements say (js/caps.js says what is left to the page): each element's `supported` — the API is there
  // and the page may use it — and <wcs-permission>'s state and `unsupportedReason` ("policy-blocked": the page it is
  // in forbids the feature; Chromium says so).
  tiltSupported: false,
  accelSupported: false,
  gyroSupported: false,
  magSupported: false,
  lightSupported: false,
  fsSupported: false,
  pipSupported: false,
  pointerLockSupported: false,
  shareSupported: false,
  contactsSupported: false,
  eyedropperSupported: false,
  passwordSupported: false,
  permAccelerometer: "prompt",
  permGyroscope: "prompt",
  permMagnetometer: "prompt",
  permLight: "prompt",
  permGeolocation: "prompt",
  /** @type {string | null} */ whyAccelerometer: null,
  /** @type {string | null} */ whyGyroscope: null,
  /** @type {string | null} */ whyMagnetometer: null,
  /** @type {string | null} */ whyLight: null,
  /** @type {string | null} */ whyClipboard: null,
  /** the iPhone's answers: <wcs-tilt> asks for the orientation, <wcs-accelerometer> for the motion (one tap, both) */
  tiltPermission: "unknown",
  motionPermission: "unknown",
  /** what the iPhone answered last time (Safari tells the page only when asked) */
  iosAnswer: null,
  seenOrientation: "unknown",
  seenMotion: "unknown",
  seenGyro: "unknown",
  seenMag: "unknown",
  seenLight: "unknown",
  /** @type {any} */ accelErrorInfo: null,
  /** @type {any} */ gyroErrorInfo: null,
  /** @type {any} */ magErrorInfo: null,
  /** @type {any} */ lightErrorInfo: null,
  /** @type {any} */ tiltError: null,
  fsFailed: null,
  lockFailed: null,
  pipFailed: null,
  shareFailed: null,
  contactsFailed: null,
  eyedropperFailed: null,
  passwordFailed: null,
  probing: false,
  asking: false,

  get checkRows() {
    const caps = this.caps;
    if (!caps) return [];
    const ios = caps.ios;
    const iosKnown = this.tiltPermission !== "unknown" ? this.tiltPermission : this.iosAnswer ?? "unknown";
    const motionKnown = this.motionPermission !== "unknown" ? this.motionPermission : this.iosAnswer ?? "unknown";
    const deniedA = webPerm(this.permAccelerometer) === "denied", deniedG = webPerm(this.permGyroscope) === "denied";
    const orientPerm = ios ? iosPerm(iosKnown) : deniedA || deniedG ? "denied" : null;
    const motionPerm = ios ? iosPerm(motionKnown) : deniedA ? "denied" : null;
    const gyroPerm = ios ? iosPerm(motionKnown) : deniedG ? "denied" : null;
    const blockedA = this.whyAccelerometer === "policy-blocked", blockedG = this.whyGyroscope === "policy-blocked";
    const inputs = {
      orientation: { ...availability({ supported: this.tiltSupported, policyBlocked: blockedA || blockedG }), permission: orientPerm, readings: this.seenOrientation },
      motion: { ...availability({ supported: this.accelSupported, policyBlocked: blockedA }), permission: motionPerm, readings: this.seenMotion },
      gyroscope: { ...availability({ supported: this.gyroSupported, policyBlocked: blockedG }), permission: gyroPerm, readings: this.seenGyro },
      magnetometer: { ...availability({ supported: this.magSupported, api: caps.api.magnetometer, policyBlocked: this.whyMagnetometer === "policy-blocked" }), permission: webPerm(this.permMagnetometer) === "denied" ? "denied" : null, readings: this.seenMag, failed: sensorFail(this.magErrorInfo) },
      light: { ...availability({ supported: this.lightSupported, policyBlocked: this.whyLight === "policy-blocked" }), permission: webPerm(this.permLight) === "denied" ? "denied" : null, readings: this.seenLight, failed: sensorFail(this.lightErrorInfo) },
      fullscreen: { ...availability({ supported: this.fsSupported, api: caps.api.fullscreen }), failed: this.fsFailed },
      // a lock needs the screen to be fullscreen first
      orientationLock: { ...availability({ supported: caps.api.orientationLock && this.fsSupported, api: caps.api.orientationLock && caps.api.fullscreen }), failed: this.lockFailed },
      pip: { ...availability({ supported: this.pipSupported, api: caps.api.pip }), failed: this.pipFailed },
      share: { ...availability({ supported: this.shareSupported, api: caps.api.share }), failed: this.shareFailed },
      contacts: { ...availability({ supported: this.contactsSupported, api: caps.api.contacts }), failed: this.contactsFailed },
      eyedropper: { ...availability({ supported: this.eyedropperSupported }), failed: this.eyedropperFailed },
      // saved passwords are refused in a frame of another origin
      password: { ...availability({ supported: this.passwordSupported && !caps.crossOriginFrame, api: this.passwordSupported }), failed: this.passwordFailed },
    };
    return CHECK.map(([key, label]) => {
      const status = lineStatus(inputs[key]);
      return {
        key, label, status, text: STATUS_TEXT[status],
        advice: lineAdvice(status, { ios: ios && SENSOR_LINES.includes(key), framed: caps.framed }),
        canAsk: status === "prompt" || (status === "denied" && ios && SENSOR_LINES.includes(key) && this.tiltPermission === "unknown"),
        offerNewTab: status === "policy" && caps.framed,
      };
    });
  },
  get anyPolicyBlocked() { return this.checkRows.some((r) => r.status === "policy"); },
  get anyPrompt() { return this.checkRows.some((r) => r.status === "prompt"); },
  get sensorsGranted() { return !this["caps.ios"] || this.tiltPermission === "granted"; },
  get motionGranted() { return !this["caps.ios"] || this.motionPermission === "granted"; },

  /** 許可する: on an iPhone, asks once for both sensors (Safari asks only from a tap); elsewhere starts a short check. */
  askSensors() {
    if (this["caps.ios"]) {
      // Both questions in the same tap, synchronously: awaiting the first would spend the tap.
      const tilt = this.$command.tiltAsk.emit();
      const motion = this.$command.motionAsk.emit();
      this.asking = true;
      Promise.all([...tilt, ...motion]).finally(() => { this.asking = false; this.startProbe(); });
      return;
    }
    this.startProbe();
  },
  startProbe() {
    this.probing = true;
    this.$command.probeReset.emit();
    this.$command.probeStart.emit();
  },

  // ============================================================ sensors: which run, and when
  // <wcs-accelerometer> and <wcs-gyroscope> read the sensor class where the browser has it and `devicemotion` where it
  // has not (an iPhone); <wcs-tilt> gives the angles and north (`heading`). `supported` folds in a forbidding policy.
  get usingGyro() { return this.gyroSupported && this.gyroErrorInfo == null; },
  get sensorPlan() {
    const caps = this.caps;
    if (!caps || !this.pageVisible) return "";
    const r = this.routeName;
    const walk = r === "walk", spot = r === "spot", probe = this.probing;
    const on = [];
    if ((walk || spot || probe) && this.tiltSupported && this.sensorsGranted) on.push("tilt");
    if ((walk || probe) && this.accelSupported && this.motionGranted) on.push("accel");
    // the viewer turns with the gyroscope while it works (with the tilt's alpha otherwise); the check tries it either way
    if (((spot && this.usingGyro) || probe) && this.gyroSupported && this.motionGranted) on.push("gyro");
    if ((walk || probe) && this.magSupported) on.push("mag");
    if ((walk || spot || probe) && this.lightSupported && (this.themeChoice === "auto" || probe)) on.push("light");
    if (walk && this.loggedIn) on.push("geo");
    // A permission taken away in the browser's settings stops what needs it at once.
    const deniedA = this.permAccelerometer === "denied", deniedG = this.permGyroscope === "denied";
    const stopped = new Set([
      ...(deniedA || deniedG ? ["tilt"] : []), ...(deniedG ? ["gyro"] : []),
      ...(deniedA ? ["accel"] : []), ...(this.permMagnetometer === "denied" ? ["mag"] : []),
    ]);
    // A sensor already known to give nothing on this device (a PC) is not kept running outside the check.
    const nothing = { tilt: "seenOrientation", accel: "seenMotion", gyro: "seenGyro", mag: "seenMag", light: "seenLight" };
    return SENSORS.filter((s) => on.includes(s) && !stopped.has(s) && (probe || !nothing[s] || this[nothing[s]] !== "none")).join(",");
  },

  // ============================================================ コンパス
  lat: null,
  lng: null,
  geoAccuracy: null,
  /** @type {any} */ geoError: null,
  heading: null,
  /** @type {any} */ wakeErrorInfo: null,
  screenAngle: 0,
  steps: 0,
  stepsOwner: "",
  stepsNote: "",
  magDisturbed: false,
  magStrength: null,
  codeInput: "",
  stampBody: null,
  stampTrigger: false,
  stampLoading: false,
  /** @type {any} */ stampError: null,
  stampStatus: 0,
  stampMessage: "",
  stampFailed: false,
  /** @type {any} */ pendingStamp: null,
  offline: false,
  get savedSteps() { return { number: this.participantNumber, count: this.steps }; },
  set savedSteps(v) {
    if (v && typeof v.count === "number") { this.steps = v.count; this.stepsOwner = String(v.number ?? ""); }
  },
  get position() { return this.lat == null ? null : { lat: this.lat, lng: this.lng }; },
  get next() { return nextSpot(this.spots, this.stamps); },
  get nextName() { return this["next.name"] ?? ""; },
  get nextDistance() { return distanceM(this.position, this.next); },
  get nextBearing() { return bearingDeg(this.position, this.next); },
  get nextDistanceText() { return formatDistance(this.nextDistance); },
  get headingKnown() { return this.heading != null; },
  get arrowAngle() { return arrowRotation(this.nextBearing, this.heading); },
  get arrowTransform() { return `rotate(${Math.round(this.arrowAngle ?? 0)}deg)`; },
  get showArrow() { return this.headingKnown && this.nextBearing != null; },
  get directionLabel() { return directionText(this.nextBearing, this.nextDistance); },
  get northNote() {
    if (this.headingKnown) return "";
    // readings arrive, and none of them says where north is
    if (this.seenOrientation === "yes") return "この端末は北の向きを教えてくれません。方角を文字で示します。";
    return "北の向きがわからないので、方角を文字で示します。";
  },
  get locationNote() {
    if (this.lat != null) return "";
    const e = this.geoError;
    if (this.permGeolocation === "denied" || e?.code === 1) return "位置情報が許可されていません。看板の4けたの番号でもスタンプを押せます。";
    if (this.permGeolocation === "unsupported") return "このページでは位置情報が使えません。看板の4けたの番号でスタンプを押せます。";
    return "現在地を調べています…";
  },
  get nearNext() { return this.nextDistance != null && this.nextDistance <= 30; },
  get codeOk() { return /^\d{4}$/.test(this.codeInput); },
  get canStamp() { return this.next != null && (this.nearNext || this.codeOk) && !this.stampLoading; },
  get stampHint() {
    if (!this.next) return "すべての場所を回りました！";
    if (this.nearNext) return "スマートフォンを3回ふるか、ボタンを押してください。";
    return "場所から30m以内に近づくか、看板の4けたの番号を入れてください。";
  },
  get magWarning() { return this.magDisturbed ? "近くに鉄のものがあります。矢印がずれるかもしれません" : ""; },
  stampNow(source = "button") {
    const spot = this.next;
    if (!spot || this.stampLoading) return;
    if (this.stampedIds.includes(spot.id)) return;
    if (!this.nearNext && !this.codeOk) return;
    const body = { spotId: spot.id };
    if (this.lat != null) { body.lat = this.lat; body.lng = this.lng; }
    if (this.codeOk) body.code = this.codeInput;
    this.stampMessage = source === "shake" ? "ふりました！ 送っています…" : "送っています…";
    this.stampFailed = false;
    this.pendingStamp = body;
    this.stampBody = { ...body };
    this.stampTrigger = true;
  },
  stampButton() { this.stampNow("button"); },
  retryStamp() {
    if (!this.pendingStamp || this.stampLoading) return;
    this.stampMessage = "もう一度送っています…";
    this.stampFailed = false;
    this.stampBody = { ...this.pendingStamp };
    this.stampTrigger = true;
  },

  // ============================================================ 明るさ / theme
  /** @type {string | null} */
  themeOverride: null,
  lightLevel: null,
  prefersDark: false,
  prefersContrast: false,
  get themeChoice() { return this.themeOverride ?? "auto"; },
  set themeChoice(v) { this.themeOverride = v; },
  get theme() {
    return themeFor({ override: this.themeChoice, lightLevel: this.lightLevel, prefersDark: this.prefersDark, prefersContrast: this.prefersContrast });
  },

  // ============================================================ チーム
  teamForm: { name: "", color: "#2e7d32" },
  /** @type {Member[]} */
  members: [],
  newMember: { name: "", email: "" },
  teamBody: null,
  teamTrigger: false,
  teamLoading: false,
  /** @type {any} */ teamError: null,
  teamMessage: "",
  contactsLoading: false,
  contactsCancelled: false,
  /** @type {any} */ contactsError: null,
  contactsMessage: "",
  picking: false,
  pickCancelled: false,
  /** @type {any} */ pickError: null,
  get swatches() { return SWATCHES.map((color) => ({ color })); },
  get "swatches.*.selected"() { return this["teamForm.color"] === this["swatches.*.color"]; },
  get "swatches.*.label"() { return "色 " + this["swatches.*.color"]; },
  get fieldErrors() { return this.teamError ? parseBody(this.teamError).errors ?? {} : {}; },
  get nameError() { return this.fieldErrors.name ?? ""; },
  get colorError() { return this.fieldErrors.color ?? ""; },
  get membersError() { return this.fieldErrors.members ?? ""; },
  get "members.*.emailError"() { return this.fieldErrors[`members.${this.$1}.email`] ?? ""; },
  get membersFull() { return this.members.length >= MAX_MEMBERS; },
  get canPickContacts() { const r = this.checkRows.find((x) => x.key === "contacts"); return r?.status === "ok"; },
  get canPickColor() { const r = this.checkRows.find((x) => x.key === "eyedropper"); return r?.status === "ok"; },
  pickSwatch(e, i) { this["teamForm.color"] = SWATCHES[i]; },
  addMember() {
    const r = mergeContacts(this.members, [{ name: [this["newMember.name"]], email: [this["newMember.email"]] }]);
    if (r.duplicates) { this.contactsMessage = "そのメールアドレスの人はもういます。"; return; }
    if (r.overflow) { this.contactsMessage = "メンバーは5人までです。"; return; }
    if (!r.added) return;
    this.members = r.members;
    this.newMember = { name: "", email: "" };
    this.contactsMessage = "";
  },
  removeMember(e, i) { this.members = this.members.toSpliced(i, 1); },
  pickContacts() {
    this.contactsMessage = "";
    this.$command.contactsSelect.emit(["name", "email"], { multiple: true });
  },
  pickColor() { this.$command.colorPick.emit(); },
  saveTeam() {
    this.teamMessage = "";
    this.teamBody = { name: this["teamForm.name"], color: this["teamForm.color"], members: this.members.map((m) => ({ name: m.name, email: m.email })) };
    this.teamTrigger = true;
  },

  // ============================================================ 場所 (viewer, video, share)
  get spot() { return this.spots.find((s) => s.id === this["routeParams.id"]) ?? null; },
  get onSpot() { return this.routeName === "spot"; },
  get offstageHidden() { return this.onSpot ? null : "true"; },
  get spotTitle() { return (this["spot.name"] ?? "場所") + " — みどり市 まち歩きスタンプラリー"; },
  get spotStamped() { return this.spot != null && this.stampedIds.includes(this.spot.id); },
  viewAngle: 0,
  viewerFs: false,
  certFs: false,
  /** @type {any} */ fsError: null,
  /** @type {any} */ fsErrorInfo: null,
  orientType: "",
  portrait: true,
  /** @type {any} */ lockErrorInfo: null,
  pointerLocked: false,
  /** @type {any} */ pointerLockErrorInfo: null,
  dragging: false,
  dragStartX: 0,
  dragStartAngle: 0,
  get panoUrl() { return this.spot ? `url("${this.spot.panorama}")` : "none"; },
  get viewAngleRounded() { return Math.round(this.viewAngle); },
  get stripPosition() { return `calc(50cqw - ${((this.viewAngle / 360) * 600).toFixed(3)}cqh)`; },
  get viewerButtonLabel() { return this.viewerFs ? "閉じる" : "全画面で見る"; },
  get canFullscreen() { const r = this.checkRows.find((x) => x.key === "fullscreen"); return r?.status === "ok"; },
  get mouseLookHint() { return this.pointerLocked ? "マウスで見回せます。Esc で終わります。" : this.pointerLockErrorInfo && this.prefersFinePointer ? "ドラッグして見回せます。" : ""; },
  toggleViewerFs() {
    if (this.viewerFs) { this.$command.viewerFsExit.emit(); return; }
    // Fullscreen in the tap; the orientation lock follows once the viewer *is* fullscreen ($watch viewerFs) — a lock
    // needs fullscreen first, and the element's `active` is what says it is.
    this.$command.viewerFsRequest.emit();
  },
  viewerPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "mouse" && this.pointerLockUsable && !this.pointerLocked) {
      // in the click: the browser captures the cursor. Until it does — or if it refuses (no focus, a frame that
      // forbids it) — the press drags, so the click never does nothing.
      this.$command.pointerLockRequest.emit();
    }
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartAngle = this.viewAngle;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  },
  viewerPointerMove(e) {
    if (!this.dragging || this.pointerLocked) return;
    const h = e.currentTarget.clientHeight || 300;
    this.viewAngle = dragAngle(this.dragStartAngle, e.clientX - this.dragStartX, h);
  },
  viewerPointerUp() { this.dragging = false; },
  // workaround: <wcs-pointer-lock> does not expose movementX/movementY (its README: read them yourself)
  viewerMouseMove(e) {
    if (!this.pointerLocked || !e.movementX) return;
    const h = e.currentTarget.clientHeight || 300;
    this.viewAngle = dragAngle(this.viewAngle, e.movementX, h);
  },
  viewerKey(e) {
    if (e.key === "ArrowLeft") this.viewAngle = wrapAngle(this.viewAngle - 10);
    if (e.key === "ArrowRight") this.viewAngle = wrapAngle(this.viewAngle + 10);
  },
  get pointerLockUsable() { return this.prefersFinePointer && this.pointerLockSupported; },
  prefersFinePointer: false,

  // --- 案内の動画 / 小窓
  pipActive: false,
  pipSpotId: null,
  pipWantPlay: false,
  /** @type {any} */ pipErrorInfo: null,
  get videoSpotId() { return this.pipActive ? this.pipSpotId : this["spot.id"] ?? this.pipSpotId; },
  get videoSrc() { return this.videoSpotId ? `/video/${this.videoSpotId}` : null; },
  get videoCaption() {
    const s = this.spots.find((x) => x.id === this.videoSpotId);
    return s ? `${s.name} の案内` : "";
  },
  get canPip() { const r = this.checkRows.find((x) => x.key === "pip"); return r?.status === "ok"; },
  get pipHere() { return this.pipActive && this.pipSpotId === this["spot.id"]; },
  get pipElsewhere() { return this.pipActive && this.pipSpotId !== this["spot.id"]; },
  get pipLabel() {
    const s = this.spots.find((x) => x.id === this.pipSpotId);
    return s ? `小窓で再生中：${s.name}` : "小窓で再生中";
  },
  openPip() {
    const id = this["spot.id"];
    if (id == null) return;
    if (this.pipActive) {
      // A second place's video replaces the first in the small window that is already open.
      this.pipSpotId = id;
      this.pipWantPlay = true;
      return;
    }
    this.pipSpotId = id;
    this.$command.pipRequest.emit();                      // in the tap
    // workaround: no wcstack element plays a <video>; play() is called on the element itself.
    document.querySelector("#guide-video")?.play?.().catch(() => {});
  },
  closePip() { this.$command.pipExit.emit(); },
  videoLoaded() {
    if (!this.pipWantPlay) return;
    this.pipWantPlay = false;
    document.querySelector("#guide-video")?.play?.().catch(() => {});
  },

  // --- 共有
  shareLoading: false,
  shareCancelled: false,
  /** @type {any} */ shareError: null,
  shareMessage: "",
  /** @type {any} */ copyError: null,
  get canShare() { const r = this.checkRows.find((x) => x.key === "share"); return r?.status === "ok"; },
  get showCopy() { return !this.canShare && this.canCopy; },
  get showPlainUrl() { return !this.canShare && !this.canCopy; },
  get canCopy() { return this["caps.api.clipboard"] === true && this.whyClipboard !== "policy-blocked"; },
  get spotUrl() { return this.spot ? `${location.origin}/spots/${this.spot.id}` : location.origin; },
  shareSpot() {
    const s = this.spot;
    if (!s) return;
    this.shareMessage = "";
    if (!this.canShare) { this.copyLink(); return; }
    this.$command.share.emit({ title: s.name, text: `みどり市 まち歩きスタンプラリー「${s.name}」`, url: this.spotUrl });
  },
  async copyLink() {
    const results = this.$command.copy.emit(this.spot ? this.spotUrl : `${location.origin}/card`);
    await Promise.all(results);
    this.shareMessage = this.copyError ? "コピーできませんでした。アドレスバーから URL をコピーしてください。" : "リンクをコピーしました。";
  },

  // ============================================================ スタンプ帳
  cardImageReady: false,
  certOpen: false,
  get cardKey() { return this.routeName === "card" ? `${this.stampCount}|${this.teamName}|${this.teamColor}|${this.steps}` : ""; },
  get cardShareLabel() { return this.cardImageReady ? "スタンプ帳を共有" : "画像を準備しています…"; },
  get cardShareText() { return `みどり市 まち歩きスタンプラリー：${this.stampCount} / ${this.spots.length || 8} 個のスタンプを集めました！`; },
  shareCard() {
    if (!this.cardImageReady || !cardFile) return;
    this.shareMessage = "";
    const text = this.cardShareText, url = `${location.origin}/`;
    const shareEl = document.querySelector("wcs-share");
    if (this.canShare) {
      // canShare(data) is the element's plain method (packages/share/README.md)
      if (shareEl?.canShare?.({ files: [cardFile] })) {
        this.$command.share.emit({ title: "スタンプ帳", text, url, files: [cardFile] });
      } else {
        this.$command.share.emit({ title: "スタンプ帳", text, url });
      }
      return;
    }
    // No share sheet: the picture as a download.
    // workaround: no wcstack element downloads a file; a temporary <a download> does.
    const a = document.createElement("a");
    a.href = URL.createObjectURL(cardFile);
    a.download = "midori-stamp-card.png";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    this.shareMessage = "画像を保存しました。";
  },
  openCertificate() {
    this.certOpen = true;
    if (!this.canFullscreen) return;                       // shown over the page, without the browser's fullscreen
    this.$command.certFsRequest.emit();                   // in the tap; held upright by $watch certFs
  },
  closeCertificate() {
    this.certOpen = false;
    if (this.certFs) this.$command.certFsExit.emit();
  },

  // ============================================================ wake lock
  get keepAwake() { return (this.routeName === "walk" && this.loggedIn) || this.certOpen; },
  wakeHeld: false,
  // the browser may refuse the lock (a headless one does, a phone in power saving may): the screen can go off
  get wakeNote() { return this.keepAwake && !this.wakeHeld && this.wakeErrorInfo ? "この端末では画面が自動で消えることがあります。" : ""; },

  // ============================================================ tokens
  $commandTokens: [
    "tiltAsk", "motionAsk", "tiltStart", "tiltStop", "accelStart", "accelStop",
    "gyroStart", "gyroStop", "magStart", "magStop", "lightStart", "lightStop",
    "geoStart", "geoStop", "probeStart", "probeReset", "credStore", "credSignOut", "viewerFsRequest", "viewerFsExit",
    "certFsRequest", "certFsExit", "orientLock", "orientUnlock", "pointerLockRequest", "pointerLockExit",
    "pipRequest", "pipExit", "share", "copy", "contactsSelect", "colorPick",
  ],
  $eventTokens: [
    "loginResponded", "meResponded", "teamResponded", "stampResponded", "spotsResponded", "probeTimeUp",
    "tiltReading", "headingReading", "accelReading", "gyroReading", "magReading", "lightReading",
    "contactsPicked", "colorPicked", "shared", "credSilent",
  ],
  $on: {
    loginResponded(state, event) {
      const { status, value } = event.detail ?? {};
      if (status !== 200 || !value?.token) return;
      const number = state["loginForm.number"].trim(), phrase = state["loginForm.phrase"];
      state.session = value;
      state.notice = "";
      // Only now that the server has accepted the pair, offer it to the browser to remember — where it can save one
      // (`supported`: Chromium's password credentials), and not in a frame of another origin.
      if (state.passwordSupported && !state["caps.crossOriginFrame"]) {
        state.$command.credStore.emit({ id: number, password: phrase, name: value.participant?.name ?? number });
      }
      state.loginForm = { number: "", phrase: "" };
    },
    meResponded(state, event) {
      const { status, value } = event.detail ?? {};
      if (status === 200 && value) {
        state.stamps = value.stamps ?? [];
        state.team = value.team ?? null;
        if (value.team) {
          state.teamForm = { name: value.team.name, color: value.team.color };
          state.members = value.team.members.map((m) => ({ name: m.name, email: m.email }));
        }
        if (state.stepsOwner && state.stepsOwner !== state.participantNumber) { state.steps = 0; state.stepsOwner = state.participantNumber; }
        return;
      }
      if (status === 401) state.sessionExpired();
    },
    spotsResponded(state, event) {
      const { status, value } = event.detail ?? {};
      if (status === 200 && Array.isArray(value)) state.spotsValue = value;
    },
    teamResponded(state, event) {
      const { status, value } = event.detail ?? {};
      if (status === 200 && value) {
        state.team = value;
        state.teamMessage = "保存しました。";
        state.liveMessage = "チームを保存しました。";
      } else if (status === 422) {
        state.teamMessage = "直すところがあります。";
      } else if (status === 401) {
        state.sessionExpired();
      } else {
        state.teamMessage = "保存できませんでした。もう一度お試しください。";
      }
    },
    stampResponded(state, event) {
      const { status, value } = event.detail ?? {};
      if (status === 200 && value?.stamps) {
        const done = state.next;
        state.stamps = value.stamps;
        state.pendingStamp = null;
        state.codeInput = "";
        state.stampFailed = false;
        state.stampMessage = done ? `「${done.name}」のスタンプを押しました！` : "スタンプを押しました！";
        state.liveMessage = state.stampMessage;
      } else if (status === 409) {
        state.pendingStamp = null;
        state.stampMessage = "この場所のスタンプはもう押してあります。";
        state.meReload = true;
      } else if (status === 422) {
        state.pendingStamp = null;
        state.stampMessage = parseBody(state.stampError).error ?? "スタンプを押せませんでした。";
      } else if (status === 401) {
        state.sessionExpired();
      } else if (status) {
        state.stampFailed = true;
        state.stampMessage = "送れませんでした。もう一度押してください。";
      }
    },
    probeTimeUp(state, event) {
      // <wcs-timer>'s reset() dispatches a tick too, with count 0 (the timer README): only a real tick ends the check
      if (!(event.detail?.count > 0)) return;
      const covered = ["seenOrientation", "seenMotion", "seenGyro", "seenMag", "seenLight"].filter((k) => state.probeCovered(k));
      state.probing = false;
      for (const k of covered) if (state[k] === "unknown") state[k] = "none";
    },
    tiltReading(state, event) {
      stats.handled.tilt++;
      const d = event.detail ?? {};
      if (d.alpha == null && d.beta == null && d.gamma == null) {
        if (state.seenOrientation === "unknown") state.seenOrientation = "none";
        return;
      }
      if (state.seenOrientation !== "yes") state.seenOrientation = "yes";
      if (state.routeName === "spot" && !state.usingGyro && typeof d.alpha === "number") {
        const next = turnAngle(state.viewAngle, yaw.tilt, d.alpha);
        yaw.tilt = d.alpha;
        if (angleDelta(next, state.viewAngle) >= 0.5) state.viewAngle = next;
      }
    },
    headingReading(state, event) {
      stats.handled.heading++;
      // <wcs-tilt>'s `heading`: the device's top edge, clockwise from north; the screen's angle turns it into the screen's
      const h = screenHeading(event.detail, state.screenAngle);
      if (h == null) return;
      if (state.heading == null || angleDelta(h, state.heading) >= 2) state.heading = Math.round(h);
    },
    accelReading(state, event) {
      stats.handled.accel++;
      state.handleMotion(event.detail ?? {});
    },
    gyroReading(state, event) {
      stats.handled.gyro++;
      const d = event.detail ?? {};
      if (d.z == null) return;
      if (state.seenGyro !== "yes") state.seenGyro = "yes";
      if (state.routeName !== "spot") return;
      const now = performance.now();
      if (yaw.gyroT != null) {
        const dt = Math.min((now - yaw.gyroT) / 1000, 0.2);
        const next = wrapAngle(state.viewAngle - (d.z * 180 / Math.PI) * dt);
        if (angleDelta(next, state.viewAngle) >= 0.5) state.viewAngle = next;
      }
      yaw.gyroT = now;
    },
    magReading(state, event) {
      stats.handled.mag++;
      const d = event.detail ?? {};
      const m = magneticStrength(d.x, d.y, d.z);
      if (m == null) return;
      if (state.seenMag !== "yes") state.seenMag = "yes";
      mag.smooth = mag.smooth == null ? m : mag.smooth * 0.7 + m * 0.3;
      const disturbed = magneticDisturbed(mag.smooth, state.magDisturbed);
      if (disturbed !== state.magDisturbed) state.magDisturbed = disturbed;
      const rounded = Math.round(mag.smooth);
      if (rounded !== state.magStrength) state.magStrength = rounded;
    },
    lightReading(state, event) {
      stats.handled.light++;
      const d = event.detail;
      const lux = typeof d === "number" ? d : d?.illuminance;
      if (typeof lux !== "number") return;
      if (state.seenLight !== "yes") state.seenLight = "yes";
      const level = nextLightLevel(state.lightLevel, lux);
      if (level !== state.lightLevel) state.lightLevel = level;
    },
    contactsPicked(state, event) {
      const picked = event.detail?.value ?? event.detail;
      if (!Array.isArray(picked) || picked.length === 0) return;
      const r = mergeContacts(state.members, picked);
      state.members = r.members;
      const parts = [];
      if (r.added) parts.push(`${r.added}人を加えました`);
      if (r.duplicates) parts.push(`${r.duplicates}人はもういます`);
      if (r.overflow) parts.push(`${r.overflow}人は5人をこえるので加えませんでした`);
      state.contactsMessage = parts.join("。") + (parts.length ? "。" : "");
    },
    colorPicked(state, event) {
      const hex = (event.detail?.value ?? event.detail)?.sRGBHex;
      if (typeof hex !== "string") return;
      state["teamForm.color"] = hex.toLowerCase();
      if (state["teamForm.name"]) state.saveTeam();       // a colour picked becomes the team's colour and is sent
      else state.teamMessage = "色を選びました。チーム名を入れて保存してください。";
    },
    shared(state) {
      state.shareMessage = "共有しました。";
    },
    credSilent() { /* the silent get's result is used by js/auth.js; nothing to show */ },
  },

  // ============================================================ helpers called from handlers
  handleMotion(d) {
    if (d.x == null || d.y == null || d.z == null) {
      if (this.seenMotion === "unknown") this.seenMotion = "none";
      return;
    }
    if (this.seenMotion !== "yes") this.seenMotion = "yes";
    if (this.routeName !== "walk") return;
    const t = performance.now();
    if (stepper.push(d.x, d.y, d.z, t)) {
      this.steps = this.steps + 1;
      if (this.stepsNote) this.stepsNote = "";
    }
    if (shake.push(d.x, d.y, d.z, t) && this.canStamp) this.stampNow("shake");
  },
  probeCovered(key) {
    const plan = this.sensorPlan;
    if (key === "seenOrientation") return plan.includes("tilt");
    if (key === "seenMotion") return plan.includes("accel");
    if (key === "seenGyro") return plan.includes("gyro");
    if (key === "seenMag") return plan.includes("mag");
    if (key === "seenLight") return plan.includes("light");
    return false;
  },
  sessionExpired() {
    this.sessionEndReason = "expired";
    const where = location.pathname + location.search;
    silentSignIn({ again: true }).then((s) => {
      if (s?.token) { this.session = s; this.sessionEndReason = ""; return; }
      this.notice = "もう一度サインインしてください。";
      this.session = null;
      if (this.onMemberPage) this.replaceUrl = "/login?next=" + encodeURIComponent(where);
    });
  },
  get onMemberPage() { return ["team", "walk", "card"].includes(this.routeName); },

  // ============================================================ watches
  $watch: {
    token(cur, prev) {
      if (cur === prev) return;
      if (prev) {
        const reason = this.sessionEndReason;
        this.sessionEndReason = "";
        this.stamps = [];
        this.team = null;
        this.members = [];
        this.teamForm = { name: "", color: SWATCHES[0] };
        if (reason === "expired") return;
        if (reason === "logout") { this.navigateUrl = "/"; return; }
        if (this.onMemberPage) this.replaceUrl = "/";
      }
      if (cur && this.routeName === "login") this.replaceUrl = safeNext(this["query.next"]);
    },
    routeName(cur, prev) {
      if (cur !== "login") this.loginError = null;
      if (prev === "spot" && cur !== "spot") {
        // The viewer stays in the page (it lives outside the route); leaving the place lets go of the screen.
        if (this.viewerFs) this.$command.viewerFsExit.emit();
        if (this.pointerLocked) this.$command.pointerLockExit.emit();
        this.dragging = false;
      }
      if (cur === "spot") { yaw.tilt = null; yaw.gyroT = null; }
      if (cur === "home" && !this.probing) this.startProbe();
      if (cur === "card" || cur === "walk") this.meReload = true;
      if (cur !== "walk") this.stepsNote = "";
      this.shareMessage = "";
    },
    routeData(data) {
      const s = data?.signedInSilently;
      if (s?.token && !this.loggedIn) this.session = s;
    },
    "routeParams.id"() { this.viewAngle = 0; this.shareMessage = ""; },
    sensorPlan(cur, prev) {
      const now = new Set((cur ?? "").split(",").filter(Boolean));
      const was = new Set((prev ?? "").split(",").filter(Boolean));
      for (const s of SENSORS) {
        if (now.has(s) && !was.has(s)) { stats.starts.push(s); this.$command[`${s}Start`].emit(); if (s === "accel") { stepper.reset(); shake.reset(); } }
        if (!now.has(s) && was.has(s)) { stats.stops.push(s); this.$command[`${s}Stop`].emit(); if (s === "mag") mag.smooth = null; }
      }
    },
    pageVisible(cur, prev) {
      if (cur && prev === false && this.routeName === "walk") this.stepsNote = "画面を閉じていた間は数えていません";
    },
    tiltPermission(cur) {
      // "denied" is the user's answer: a question refused because it was not asked from a tap leaves it as it was
      if (cur === "granted" || cur === "denied") { if (this.iosAnswer !== cur) this.iosAnswer = cur; }
    },
    viewerFs(cur, prev) {
      if (cur && !prev) this.$command.orientLock.emit("landscape");
      if (prev && !cur) this.$command.orientUnlock.emit();
    },
    certFs(cur, prev) {
      if (cur && !prev) this.$command.orientLock.emit("portrait");
      if (prev && !cur) { this.certOpen = false; this.$command.orientUnlock.emit(); }
    },
    fsErrorInfo(info) {
      if (!info) return;
      if (info.code === "capability-missing") this.fsFailed = "none";
    },
    lockErrorInfo(info) {
      // a lock refused while the screen *is* fullscreen: this device cannot hold the orientation
      if (info && info.code === "not-allowed" && (this.viewerFs || this.certFs || document.fullscreenElement)) this.lockFailed = "none";
    },
    pipErrorInfo(info) {
      if (info?.code === "capability-missing") this.pipFailed = "none";
    },
    shareError(err) {
      if (!err) return;
      if (err.name === "NotAllowedError" && this.framed) this.shareFailed = "policy";
      this.shareMessage = "共有できませんでした。" + (this.framed ? "新しいタブで開いてお試しください。" : "");
    },
    contactsError(err) {
      if (err) this.contactsMessage = "連絡先を読めませんでした。名前とメールを入力してください。";
    },
    pickError(err) {
      if (err) this.teamMessage = "色を拾えませんでした。下の色から選んでください。";
    },
    offline(cur, prev) {
      if (prev && !cur && this.pendingStamp && this.stampFailed) this.retryStamp();
    },
    stampLoading(cur, prev) {
      // a request that failed without an answer (offline): the response event does not come
      if (prev && !cur && this.stampError && !this.stampStatus) {
        this.stampFailed = true;
        this.stampMessage = this.offline ? "電波がありません。つながったら自動でもう一度送ります。" : "送れませんでした。もう一度押してください。";
      }
    },
    cardKey(key) {
      if (!key) return;
      this.makeCardImage();
    },
  },

  makeCardImage() {
    const ticket = ++cardMaking;
    this.cardImageReady = false;
    const c = document.createElement("canvas");
    c.width = 600; c.height = 400;
    const g = c.getContext("2d");
    if (!g) return;
    g.fillStyle = "#fffdf5"; g.fillRect(0, 0, 600, 400);
    g.fillStyle = this.teamColor; g.fillRect(0, 0, 600, 60);
    g.fillStyle = "#fff"; g.font = "bold 26px sans-serif"; g.fillText("みどり市 まち歩きスタンプラリー", 20, 40);
    g.fillStyle = "#222"; g.font = "20px sans-serif";
    g.fillText(`${this.teamName || this.participantName}　${this.stampCount} / ${this.spots.length || 8}`, 20, 95);
    this.spots.forEach((s, i) => {
      const x = 30 + (i % 4) * 140, y = 130 + Math.floor(i / 4) * 130;
      g.strokeStyle = "#888"; g.beginPath(); g.arc(x + 50, y + 50, 45, 0, Math.PI * 2); g.stroke();
      if (this.stampedIds.includes(s.id)) { g.fillStyle = "#c62828"; g.beginPath(); g.arc(x + 50, y + 50, 40, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "#222"; g.font = "13px sans-serif"; g.fillText(s.name.slice(0, 9), x, y + 115);
    });
    c.toBlob((blob) => {
      if (ticket !== cardMaking || !blob) return;
      cardFile = new File([blob], "midori-stamp-card.png", { type: "image/png" });
      globalThis.__srCardFile = { type: cardFile.type, size: cardFile.size };
      this.cardImageReady = true;
    }, "image/png");
  },

  // ============================================================ lifecycle
  async $connectedCallback() {
    this.caps = detectCaps(globalThis);
    const delay = new URLSearchParams(location.search).get("delay");
    this.apiQ = delay ? `?delay=${encodeURIComponent(delay)}` : "";
    // workaround: no wcstack element reports document.visibilityState; one listener writes it into state.
    this.pageVisible = document.visibilityState !== "hidden";
    document.addEventListener("visibilitychange", () => { this.pageVisible = document.visibilityState !== "hidden"; });
    if (this.routeName === "home") this.startProbe();
    // workaround: <wcs-tilt> and <wcs-accelerometer> start a page load at "unknown" (Safari tells a page its answer only
    // when asked; their READMEs: a page that wants to remember keeps its own note); the last answer is kept in
    // <wcs-storage key="sr.iosAnswer"> and, only when there is one, asked again here — assumed: Safari gives a decided
    // answer without a tap and without showing anything (not verified on a phone).
    if (this["caps.ios"] && this.iosAnswer) {
      Promise.all([...this.$command.tiltAsk.emit(), ...this.$command.motionAsk.emit()]).catch(() => {});
    }
    if (!this.loggedIn) {
      const s = await silentSignIn();
      if (s?.token && !this.loggedIn) this.session = s;
    }
  },
};
