import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";
import {
  INSTALL_SENSORS, MAZE_ROUTE, START_TILT_PILOT, accel, ballPos, expectBallAt, gotoWithPausedClock, runPilot,
  sensorLog, tilt,
} from "./tilt-maze-stubs";

// examples/signals-tilt-maze の実ブラウザテスト。
//
// state-tilt-maze と同じゲーム・同じ 4 つの I/O ノード（<wcs-tilt> / <wcs-accelerometer> /
// <wcs-raf> / <wcs-wakelock>）を、@wcstack/signals の bindNode で駆動する版。
// <wcs-raf> だけ静的 import、センサー 2 つと wakelock は動的 import で、読み込みに
// 失敗したらその機能だけを諦める。Start は tilt.requestPermission() の結果を待って
// tilt.start() を呼ぶ（state 版は command token で同時に扇形配信する）。
//
// このスペックは「signals 版が実ブラウザで動き、入力に応える」ことを短く固定する:
// Start の配信と wake lock（プレイ中だけ）、傾き・ドラッグ・キーでの移動、穴と
// Retry / 振って再開、閉ループでのゴール、センサーパッケージの読み込み失敗。
//
// プラットフォーム API の用意は state 版と同じ（tilt-maze-stubs.ts）。ゲームループは
// 実物の <wcs-raf> を page.clock の偽 requestAnimationFrame で、ロード前から止めた時計の
// runFor() 分だけ決定的に回す（gotoWithPausedClock）。
// @wcstack/signals/dom は serve.mjs が /packages/signals/dist/dom.esm.js に書き換える。

const URL = "/examples/signals-tilt-maze/";

const overlayTitle = (page: Page) => page.locator(".board .overlay h2");
const overlayButton = (page: Page) => page.locator(".board .overlay button");
const timeText = (page: Page) => page.locator(".hud .time");
const controlChip = (page: Page) => page.locator(".hud .chip[role=status]");
const wakeChip = (page: Page) => page.locator(".hud .chip").filter({ hasText: /^screen:/ });

async function openMaze(page: Page) {
  await page.addInitScript(INSTALL_SENSORS, { tiltPermission: "granted" as const });
  await gotoWithPausedClock(page, URL);
}

async function startGame(page: Page) {
  await expect(overlayButton(page)).toHaveText("Start");
  await expect(overlayButton(page)).toBeEnabled();
  await overlayButton(page).click();
  await expect(page.locator(".board .overlay")).toHaveCount(0);
}

test.describe("examples/signals-tilt-maze", () => {
  test("Start でセンサーを起動し、プレイ中だけ wake lock を取り、傾きで転がって穴に落ちる", async ({ page }) => {
    const errors = collectErrors(page);
    await openMaze(page);

    // h() が組んだ盤面と HUD。
    await expect(page.locator(".board .wall")).toHaveCount(4);
    await expect(page.locator(".board .hole")).toHaveCount(4);
    await expect(overlayTitle(page)).toHaveText("Tilt Ball Maze");
    await expect(timeText(page)).toHaveText("0.0 s");
    await expect(controlChip(page)).toHaveText("control: drag the board or use the arrow keys");
    await expect(page.locator(".loop-chip")).toHaveCSS("color", "rgb(46, 125, 50)");
    await expectBallAt(page, 30, 30);

    // アイドル: フレームは来るが進まない。wake lock も取らない（bound.set("active", false)
    // はプロパティだけを書き、<wcs-wakelock> は active 属性を外したまま）。
    await page.clock.runFor(1000);
    await expect(timeText(page)).toHaveText("0.0 s");
    await expect(wakeChip(page)).toHaveText("screen: normal");
    expect(await sensorLog(page)).toEqual([]);

    // Start: requestPermission() はクリックの中で同期に、tilt.start() はその結果を待ってから。
    await startGame(page);
    await expect(wakeChip(page)).toHaveText("screen: kept awake");
    await expect.poll(() => sensorLog(page)).toContain("tilt.start");
    const log = await sensorLog(page);
    expect([...log].sort()).toEqual(["accel.start", "tilt.requestPermission", "tilt.start", "wakelock.request:screen"]);
    expect(log[0]).toBe("tilt.requestPermission");
    expect(log.indexOf("tilt.start")).toBeGreaterThan(log.indexOf("tilt.requestPermission"));

    // 最初の読みで端末の傾きに切り替わり、右へ転がって壁で止まる。
    await tilt(page, 0, 30);
    await expect(controlChip(page)).toHaveText("control: device tilt (or arrow keys)");
    await page.clock.runFor(1000);
    const p = await ballPos(page);
    expect(p.x).toBeGreaterThan(45);
    expect(p.x).toBeLessThanOrEqual(50);
    expect(p.y).toBe(30);
    await expect(timeText(page)).toHaveText("1.0 s");

    // HUD の Reset で戻し、まっすぐ手前に傾けると (20, 140) の穴に落ちる。
    await tilt(page, 30, 0);
    await page.locator(".hud button").click();
    await page.clock.runFor(2000);
    await expect(overlayTitle(page)).toHaveText("💀 Down the hole");
    const fellAt = await ballPos(page);
    expect(Math.hypot(fellAt.x - 20, fellAt.y - 140)).toBeLessThan(11);
    await expect(wakeChip(page)).toHaveText("screen: normal");
    expect(await sensorLog(page)).toContain("wakelock.release");

    // Retry で初期位置から。もう一度落としてから、大きく振っても再開する。
    await tilt(page, 0, 0);
    await overlayButton(page).click();
    await expect(page.locator(".board .overlay")).toHaveCount(0);
    await expectBallAt(page, 30, 30);
    await expect(timeText(page)).toHaveText("0.0 s");
    await tilt(page, 30, 0);
    await page.clock.runFor(2000);
    await expect(overlayTitle(page)).toHaveText("💀 Down the hole");
    await tilt(page, 0, 0);
    await accel(page, 30, 0, 9.81);
    await page.clock.runFor(50);
    await accel(page, 0, 0, 9.81);
    await expect(page.locator(".board .overlay")).toHaveCount(0);
    await expectBallAt(page, 30, 30);

    expect(errors).toEqual([]);
  });

  test("ドラッグと矢印キーでも傾けられる", async ({ page }) => {
    const errors = collectErrors(page);
    await openMaze(page);
    await startGame(page);

    // ドラッグ: 右端寄りを押すとボードがポインタを捕まえ、右へ転がる。
    const board = (await page.locator(".board").boundingBox())!;
    await page.mouse.move(board.x + board.width * 0.9, board.y + board.height * 0.5);
    await page.mouse.down();
    expect(await page.locator(".board").evaluate((el) => el.hasPointerCapture(1))).toBe(true);
    await page.clock.runFor(800);
    let p = await ballPos(page);
    expect(p.x).toBeGreaterThan(45);
    expect(p.y).toBe(30);
    await page.mouse.up();

    // キー: Reset で戻し、ボードにフォーカスして ← で左へ、↓ で下へ。
    await page.locator(".hud button").click();
    await expectBallAt(page, 30, 30);
    await page.locator(".board").focus();
    await page.keyboard.down("ArrowLeft");
    await page.clock.runFor(300);
    await page.keyboard.up("ArrowLeft");
    p = await ballPos(page);
    expect(p.x).toBeLessThan(30);
    expect(p.y).toBe(30);
    await page.keyboard.down("ArrowDown");
    await page.clock.runFor(300);
    await page.keyboard.up("ArrowDown");
    expect((await ballPos(page)).y).toBeGreaterThan(30);

    expect(errors).toEqual([]);
  });

  test("傾きの閉ループ操作で迷路を抜けるとゴールになる", async ({ page }) => {
    // 偽の時計で 30 秒ぶん（約 1,800 フレームの物理と描画）を回すので、CPU 時間がかかる。
    // 単独で 17〜20 秒、全スイートの並列実行では 30 秒の既定を超えうる。
    test.slow();
    const errors = collectErrors(page);
    await openMaze(page);
    await startGame(page);

    await page.evaluate(START_TILT_PILOT, MAZE_ROUTE);
    await runPilot(page);
    expect(await page.evaluate(() => (window as any).__pilot)).toEqual({
      waypoint: MAZE_ROUTE.length - 1,
      stopped: true,
    });
    await expect(overlayTitle(page)).toHaveText("🎉 Goal!");
    const cleared = await timeText(page).textContent();
    await expect(page.locator(".board .overlay b")).toHaveText(cleared!);
    await page.clock.runFor(1000);
    await expect(timeText(page)).toHaveText(cleared!);
    await expect(wakeChip(page)).toHaveText("screen: normal");

    await overlayButton(page).click();
    await expectBallAt(page, 30, 30);

    expect(errors).toEqual([]);
  });

  test("センサーパッケージが読み込めないと、Start が解放されドラッグ／キー操作に落ちる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.route("**/packages/tilt/dist/auto.min.js", (route) => route.abort());
    await openMaze(page);

    // import() の reject で失敗が分かるので、5 秒を待たずに解放される。
    await expect(overlayButton(page)).toHaveText("Start");
    await expect(overlayButton(page)).toBeEnabled();
    await expect(controlChip(page)).toHaveText("control: drag or arrow keys (sensor packages failed to load)");

    await startGame(page);
    await expect.poll(async () => (await sensorLog(page)).sort()).toEqual(["accel.start", "wakelock.request:screen"]);
    await page.locator(".board").focus();
    await page.keyboard.down("ArrowRight");
    await page.clock.runFor(500);
    await page.keyboard.up("ArrowRight");
    expect((await ballPos(page)).x).toBeGreaterThan(40);

    // 中断したモジュール（modulepreload と import()）の読み込みはブラウザ自身が
    // console.error に出す。デモ自身は console.warn で知らせる（errors には入らない）。
    expect(errors.filter((e) => !/Failed to load resource: net::ERR_FAILED/.test(e))).toEqual([]);
  });
});
