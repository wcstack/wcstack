import { expect, type Page } from "@playwright/test";

// examples/state-tilt-maze と examples/signals-tilt-maze の 2 つのスペックが共有する
// プラットフォーム API のスタブと操作ヘルパ（同じゲーム・同じ 4 つの I/O ノード）。
//
// - DeviceOrientation（<wcs-tilt>）: <wcs-tilt> は window の `deviceorientation` を
//   購読する。headless Chromium はセンサーが無く、購読した直後に値がすべて null の
//   実イベント（isTrusted）を 1 回出すので、それは捕捉段階で止め、テストが
//   window.__tilt(beta, gamma) で dispatch する合成イベントだけを届ける。
//   iOS と同じ形の `DeviceOrientationEvent.requestPermission()` を足し、答え
//   （granted / denied）は init の引数で決める。
// - Accelerometer（<wcs-accelerometer>）: Generic Sensor API のクラスを偽物に差し替える。
//   start() されたインスタンスにだけ window.__accel(x, y, z) で `reading` を届ける。
// - Screen Wake Lock（<wcs-wakelock>）: navigator.wakeLock を、取得と解放を記録する
//   偽物にする。
//
// どの呼び出しも window.__sensorLog に順に記録する（"tilt.requestPermission",
// "tilt.start", "accel.start", "wakelock.request:screen", "wakelock.release"）。

export type SensorInit = { tiltPermission: "granted" | "denied" };

export const INSTALL_SENSORS = ({ tiltPermission }: SensorInit) => {
  const w = window as any;
  const log: string[] = (w.__sensorLog = []);

  // --- DeviceOrientation --------------------------------------------------
  window.addEventListener(
    "deviceorientation",
    (e) => {
      if (e.isTrusted) e.stopImmediatePropagation();
    },
    { capture: true },
  );
  const originalAdd = window.addEventListener;
  window.addEventListener = function (this: Window, type: string, ...rest: any[]) {
    if (type === "deviceorientation") log.push("tilt.start");
    return (originalAdd as any).call(this, type, ...rest);
  } as typeof window.addEventListener;
  (DeviceOrientationEvent as any).requestPermission = () => {
    log.push("tilt.requestPermission");
    return Promise.resolve(tiltPermission);
  };
  w.__tilt = (beta: number, gamma: number) =>
    window.dispatchEvent(
      new DeviceOrientationEvent("deviceorientation", { alpha: 0, beta, gamma, absolute: false }),
    );

  // --- Accelerometer -------------------------------------------------------
  const sensors: any[] = [];
  class FakeAccelerometer extends EventTarget {
    x: number | null = null;
    y: number | null = null;
    z: number | null = null;
    activated = false;
    constructor() {
      super();
      sensors.push(this);
    }
    start() {
      this.activated = true;
      log.push("accel.start");
    }
    stop() {
      this.activated = false;
      log.push("accel.stop");
    }
  }
  w.Accelerometer = FakeAccelerometer;
  w.__accel = (x: number, y: number, z: number) => {
    for (const s of sensors) {
      if (!s.activated) continue;
      s.x = x;
      s.y = y;
      s.z = z;
      s.dispatchEvent(new Event("reading"));
    }
  };

  // --- Screen Wake Lock ----------------------------------------------------
  const wakeLock = {
    request(type: string) {
      log.push(`wakelock.request:${type}`);
      const sentinel: any = new EventTarget();
      sentinel.released = false;
      sentinel.type = type;
      sentinel.release = () => {
        sentinel.released = true;
        log.push("wakelock.release");
        return Promise.resolve();
      };
      return Promise.resolve(sentinel);
    },
  };
  Object.defineProperty(Navigator.prototype, "wakeLock", { configurable: true, get: () => wakeLock });
};

// 時計を止めた状態でページを開く。page.clock.install() だけだと偽の時計は実時間で
// 進み続け（Playwright の既定）、runFor() はそれに上乗せするだけなので、負荷が高いと
// テストの命令の合間に実時間ぶんのフレームが走る（Reset の直後にボールが動く、
// runFor(1000) の後のタイムが 1.0 s にならない）。goto の前に pauseAt() まで済ませると、
// 新しい文書でもそのログが再生されて最初から止まった時計で始まり、フレーム
// （16ms 刻み）は runFor() で進めた分だけになる。
const CLOCK_START = Date.parse("2026-01-01T00:00:00Z");
export async function gotoWithPausedClock(page: Page, url: string) {
  await page.clock.install({ time: CLOCK_START });
  await page.clock.pauseAt(CLOCK_START + 10_000);
  await page.goto(url);
}

export const sensorLog = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as any).__sensorLog]);

export const tilt = (page: Page, beta: number, gamma: number) =>
  page.evaluate(([b, g]) => (window as any).__tilt(b, g), [beta, gamma] as const);

export const accel = (page: Page, x: number, y: number, z: number) =>
  page.evaluate(([ax, ay, az]) => (window as any).__accel(ax, ay, az), [x, y, z] as const);

// ボールの中心（盤面の論理座標）。両デモとも .ball の transform に translate(x, y) を書く。
export const ballPos = (page: Page) =>
  page.locator(".board .ball").evaluate((el) => {
    const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec((el as HTMLElement).style.transform);
    if (!m) throw new Error(`unexpected transform: ${(el as HTMLElement).style.transform}`);
    return { x: Number(m[1]), y: Number(m[2]) };
  });

export async function expectBallAt(page: Page, x: number, y: number) {
  expect(await ballPos(page)).toEqual({ x, y });
}

// 迷路の通り道（盤面の論理座標）。列の間の壁の切れ目を、穴から離れた線で縫う:
// 左の列を下り → 壁 1 の下をくぐり → 列 2 を上り → 壁 2 の上を越え → 列 3 を下り →
// 壁 3 の下をくぐり → 列 4 を上り → 壁 4 の上を越え → 右端の列を下ってゴールの旗へ。
export const MAZE_ROUTE: [number, number][] = [
  [40, 285], [100, 285], [96, 35], [175, 35], [175, 285],
  [232, 285], [230, 35], [296, 35], [296, 294],
];

// 「傾ける手」。<wcs-raf> の毎フレームの `wcs-raf:tick` に相乗りして .ball の位置を読み、
// 今の目標点へ向けた PD 制御の傾き（±30°）を __tilt で送る。目標点の 6px 以内で速度が
// 十分落ちたら次の点へ進む。盤面にオーバーレイが出たら（ゴール・落下）水平に戻して止まる。
// 自前の requestAnimationFrame を回さないのは、page.clock が偽のタイマー 1 つごとに
// 実時間で 1 タスク待つため（1 フレームのタイマーを 2 つにすると倍かかる）。
export const START_TILT_PILOT = (route: [number, number][]) => {
  const w = window as any;
  const ball = document.querySelector(".board .ball") as HTMLElement;
  const loop = document.querySelector("wcs-raf")!;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const read = () => {
    const m = /translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/.exec(ball.style.transform)!;
    return [Number(m[1]), Number(m[2])];
  };
  let i = 0;
  let prev: number[] | null = null;
  let prevTs = 0;
  w.__pilot = { waypoint: 0, stopped: false };
  const frame = (e: Event) => {
    const ts: number = (e as CustomEvent).detail.timestamp;
    if (document.querySelector(".board .overlay")) {
      loop.removeEventListener("wcs-raf:tick", frame);
      w.__tilt(0, 0);
      w.__pilot.stopped = true;
      return;
    }
    const [x, y] = read();
    const dt = prev ? (ts - prevTs) / 1000 : 0;
    const vx = prev && dt > 0 ? (x - prev[0]) / dt : 0;
    const vy = prev && dt > 0 ? (y - prev[1]) / dt : 0;
    prev = [x, y];
    prevTs = ts;
    let [tx, ty] = route[i];
    if (i < route.length - 1 && Math.abs(tx - x) < 6 && Math.abs(ty - y) < 6 && Math.hypot(vx, vy) < 20) {
      i++;
      [tx, ty] = route[i];
      w.__pilot.waypoint = i;
    }
    w.__tilt(clamp((ty - y) - 0.2 * vy, -30, 30), clamp((tx - x) - 0.2 * vx, -30, 30));
  };
  loop.addEventListener("wcs-raf:tick", frame);
};

// パイロットが止まる（オーバーレイが出る）まで、1 秒ずつ時計を進める。上限は
// 偽の時間で limitMs（迷路を抜けるのに約 17 秒かかる）。
export async function runPilot(page: Page, limitMs = 30_000) {
  for (let elapsed = 0; elapsed < limitMs; elapsed += 1000) {
    await page.clock.runFor(1000);
    if (await page.evaluate(() => (window as any).__pilot.stopped)) return;
  }
}
