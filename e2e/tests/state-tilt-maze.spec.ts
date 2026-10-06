import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";
import {
  INSTALL_SENSORS, MAZE_ROUTE, START_TILT_PILOT, accel, ballPos, expectBallAt, gotoWithPausedClock, runPilot,
  sensorLog, tilt,
  type SensorInit,
} from "./tilt-maze-stubs";

// examples/state-tilt-maze の実ブラウザテスト。
//
// デモは tilt + accelerometer + raf + wakelock + defined + state のボール迷路。
// <wcs-raf> の毎フレームの tick を event token で受けて state の step(dt) が物理を
// 1 段進め、入力は 3 系統（端末の傾き <wcs-tilt> / ボードのドラッグ / 矢印キー）。
// Start の 1 クリックが command token `startSensors` を emit し、<wcs-tilt> の
// requestPermission() と start()、<wcs-accelerometer> の start() に宣言順で
// 扇形に届く。<wcs-defined> が 2 つのセンサーパッケージの登録を見張り、
// 解決するまで Start を押せなくし、5 秒で読み込み失敗とみなしてドラッグ／キー操作に
// 落とす。プレイ中だけ <wcs-wakelock> が画面を点けたままにする。
//
// このスペックが固定するもの:
//   - 迷路の描画（for: の attr.style）、HUD、raf の :state(running)、アイドル中は進まないこと
//   - Start → 3 つのセンサー命令の扇形配信（順序込み）と wake lock の取得
//   - wake lock をプレイ中だけ取ること（state の属性ミラーの回帰。そのテストのコメント参照）
//   - 傾きでの移動、壁で止まること、穴に落ちること、ゴール（閉ループで迷路を抜ける）
//   - Retry / Play again / HUD の Reset / 振って再開（加速度）
//   - ドラッグ: `onpointerdown#direct` / `onpointermove#direct` が e.currentTarget に
//     ボードを渡すこと（4.0 は #direct の無い on*: をルートへ委譲し、currentTarget は
//     ルートになる — migration-v4 §3.3）。ポインタキャプチャと、委譲された
//     `onpointerup` で操作が終わること
//   - 矢印キー（委譲された onkeydown / onkeyup）と、要素に直接付く onblur での解除
//   - 傾きの許可拒否、センサーパッケージの読み込み失敗（<wcs-defined> のタイムアウト）
//
// プラットフォーム API の用意: tilt-maze-stubs.ts（DeviceOrientation は合成イベント、
// Accelerometer と navigator.wakeLock は偽物）。ゲームループは実物の <wcs-raf> だが、
// page.clock で requestAnimationFrame を偽物にし、ロード前に時計を止めて（pauseAt）、
// page.clock.runFor() で進めた分だけフレーム（16ms 刻み）が出るようにして決定的にする
// （gotoWithPausedClock）。

const URL = "/examples/state-tilt-maze/";

const overlayTitle = (page: Page) => page.locator(".board .overlay h2");
const overlayButton = (page: Page) => page.locator(".board .overlay button");
const timeText = (page: Page) => page.locator(".hud .time");
const controlChip = (page: Page) => page.locator(".hud .chip[role=status]");
const wakeChip = (page: Page) => page.locator(".hud .chip").filter({ hasText: /^screen:/ });

async function openMaze(page: Page, init: SensorInit = { tiltPermission: "granted" }) {
  await page.addInitScript(INSTALL_SENSORS, init);
  await gotoWithPausedClock(page, URL);
}

async function startGame(page: Page) {
  await expect(overlayButton(page)).toHaveText("Start");
  await expect(overlayButton(page)).toBeEnabled();
  await overlayButton(page).click();
  await expect(page.locator(".board .overlay")).toHaveCount(0);
}

test.describe("examples/state-tilt-maze", () => {
  test("迷路と HUD を描き、Start でセンサー命令を宣言順に扇形配信して wake lock を取る", async ({ page }) => {
    const errors = collectErrors(page);
    await openMaze(page);

    // for: の行が attr.style で迷路を組む。盤面（4px の枠の内側）からの位置で確かめる。
    const board = (await page.locator(".board").boundingBox())!;
    const boxes = async (selector: string) => {
      const out: number[][] = [];
      for (const el of await page.locator(selector).all()) {
        const b = (await el.boundingBox())!;
        out.push([b.x - board.x - 4, b.y - board.y - 4, b.width, b.height].map(Math.round));
      }
      return out;
    };
    expect(await boxes(".board .wall")).toEqual([
      [60, 0, 12, 250], [130, 70, 12, 250], [200, 0, 12, 250], [260, 70, 12, 250],
    ]);
    expect(await boxes(".board .hole")).toEqual([
      [9, 129, 22, 22], [101, 169, 22, 22], [141, 109, 22, 22], [237, 169, 22, 22],
    ]);

    // HUD とアイドル表示。
    await expect(overlayTitle(page)).toHaveText("Tilt Ball Maze");
    await expect(timeText(page)).toHaveText("0.0 s");
    await expect(controlChip(page)).toHaveText("control: drag the board or use the arrow keys");
    await expectBallAt(page, 30, 30);
    // <wcs-raf> は接続と同時に走り、:state(running) でループのチップが緑になる。
    await expect(page.locator(".loop-chip")).toHaveCSS("color", "rgb(46, 125, 50)");

    // <wcs-defined> が 2 つのセンサータグの登録を見届けると Start が押せる。
    await expect(overlayButton(page)).toHaveText("Start");
    await expect(overlayButton(page)).toBeEnabled();

    // アイドル中はフレームが来ても時間もボールも進まない。
    await page.clock.runFor(1000);
    await expect(timeText(page)).toHaveText("0.0 s");
    await expectBallAt(page, 30, 30);
    expect((await sensorLog(page)).filter((e) => !e.startsWith("wakelock"))).toEqual([]);

    // Start: 1 回の emit が購読順（= 宣言順）に 3 つのメソッドへ届く。
    await startGame(page);
    expect((await sensorLog(page)).filter((e) => !e.startsWith("wakelock"))).toEqual([
      "tilt.requestPermission", "tilt.start", "accel.start",
    ]);
    // プレイ中は wake lock を取る（active: isPlaying → request("screen")）。
    await expect(wakeChip(page)).toHaveText("screen: kept awake");
    expect(await sensorLog(page)).toContain("wakelock.request:screen");

    // 入力が無ければ盤は水平: 時間だけが進み、ボールは動かない。
    await page.clock.runFor(500);
    await expect(timeText(page)).toHaveText("0.5 s");
    await expectBallAt(page, 30, 30);

    expect(errors).toEqual([]);
  });

  test("端末を傾けるとその向きに転がり、壁で止まり、Reset で初期位置に戻る", async ({ page }) => {
    const errors = collectErrors(page);
    await openMaze(page);
    await startGame(page);

    // 最初の読みが届くまではドラッグ／キー操作の案内、届くと端末の傾きに切り替わる。
    await expect(controlChip(page)).toHaveText("control: drag the board or use the arrow keys");
    await tilt(page, 0, 30); // 右へ 30°
    await expect(controlChip(page)).toHaveText("control: device tilt (or arrow keys)");

    // 右へ転がり、x=60 の壁（半径 10）の手前で止まる。上下には動かない。
    await page.clock.runFor(1000);
    let p = await ballPos(page);
    expect(p.x).toBeGreaterThan(45);
    expect(p.x).toBeLessThanOrEqual(50);
    expect(p.y).toBe(30);
    await page.clock.runFor(1000);
    p = await ballPos(page);
    expect(p.x).toBeGreaterThan(45);
    expect(p.x).toBeLessThanOrEqual(50);

    // 手前にも傾けると、壁に沿って下へ滑る。
    await tilt(page, 30, 30);
    await page.clock.runFor(400);
    const slid = await ballPos(page);
    expect(slid.y).toBeGreaterThan(40);
    expect(slid.x).toBeGreaterThan(45);

    // 左へ傾けると戻ってくる。
    await tilt(page, 0, -30);
    await page.clock.runFor(400);
    expect((await ballPos(page)).x).toBeLessThan(slid.x - 5);

    // HUD の Reset: ボールと時間が初期値に戻り、プレイは続く。
    await page.locator(".hud button").click();
    await expectBallAt(page, 30, 30);
    await expect(timeText(page)).toHaveText("0.0 s");
    await expect(page.locator(".board .overlay")).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("穴に落ちると止まり、Retry と端末を振ること（加速度）で再開する", async ({ page }) => {
    const errors = collectErrors(page);
    await openMaze(page);
    await startGame(page);

    // まっすぐ手前に傾けると、x=30 の列にある (20, 140) の穴に落ちる。
    await tilt(page, 30, 0);
    await page.clock.runFor(2000);
    await expect(overlayTitle(page)).toHaveText("💀 Down the hole");
    const fellAt = await ballPos(page);
    expect(fellAt.x).toBe(30);
    expect(Math.hypot(fellAt.x - 20, fellAt.y - 140)).toBeLessThan(11);
    // 落ちたらループは止まる: 時間もボールも凍る。
    const frozen = await timeText(page).textContent();
    await page.clock.runFor(1000);
    await expect(timeText(page)).toHaveText(frozen!);
    expect(await ballPos(page)).toEqual(fellAt);

    // Retry: 初期位置から再開する（盤を水平に戻してから）。
    await tilt(page, 0, 0);
    await overlayButton(page).click();
    await expect(page.locator(".board .overlay")).toHaveCount(0);
    await expectBallAt(page, 30, 30);
    await expect(timeText(page)).toHaveText("0.0 s");
    await page.clock.runFor(300);
    await expectBallAt(page, 30, 30);

    // もう一度落とす。
    await tilt(page, 30, 0);
    await page.clock.runFor(2000);
    await expect(overlayTitle(page)).toHaveText("💀 Down the hole");
    await tilt(page, 0, 0);

    // 重力だけの読み（|a| ≒ 9.81）は振ったことにならない。
    await accel(page, 0, 0, 9.81);
    await page.clock.runFor(200);
    await expect(overlayTitle(page)).toHaveText("💀 Down the hole");

    // 大きく振る（|a| が重力から 15 m/s² 以上離れる）と再開する。
    await accel(page, 30, 0, 9.81);
    await page.clock.runFor(50);
    await accel(page, 0, 0, 9.81);
    await expect(page.locator(".board .overlay")).toHaveCount(0);
    await expectBallAt(page, 30, 30);
    await expect(timeText(page)).toHaveText(/^0\.\d s$/);

    expect(errors).toEqual([]);
  });

  test("傾きの閉ループ操作で迷路を抜けるとゴールになり、Play again で再開する", async ({ page }) => {
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
    // ゴールの旗の正方形 (284..308, 282..306) の中で止まっている。
    const p = await ballPos(page);
    expect(p.x).toBeGreaterThanOrEqual(284);
    expect(p.x).toBeLessThanOrEqual(308);
    expect(p.y).toBeGreaterThanOrEqual(282);
    expect(p.y).toBeLessThanOrEqual(306);
    // オーバーレイのタイムは HUD と同じ値で、クリア後は進まない。
    const cleared = await timeText(page).textContent();
    expect(cleared).toMatch(/^\d+\.\d s$/);
    await expect(page.locator(".board .overlay b")).toHaveText(cleared!);
    await page.clock.runFor(1000);
    await expect(timeText(page)).toHaveText(cleared!);

    await overlayButton(page).click();
    await expect(page.locator(".board .overlay")).toHaveCount(0);
    await expectBallAt(page, 30, 30);
    await expect(timeText(page)).toHaveText("0.0 s");

    expect(errors).toEqual([]);
  });

  test("ボードのドラッグで傾き、#direct のハンドラがボードを currentTarget に受け取る", async ({ page }) => {
    const errors = collectErrors(page);
    await openMaze(page);
    await startGame(page);

    const board = (await page.locator(".board").boundingBox())!;
    const at = (fx: number, fy: number) => [board.x + board.width * fx, board.y + board.height * fy] as const;

    // 右端寄りを押す: dragStart が e.currentTarget（= ボード）でポインタを捕まえ、
    // dragMove がボードの矩形から右 30° を計算する。
    await page.mouse.move(...at(0.9, 0.5));
    await page.mouse.down();
    expect(await page.locator(".board").evaluate((el) => el.hasPointerCapture(1))).toBe(true);
    await page.clock.runFor(800);
    let p = await ballPos(page);
    expect(p.x).toBeGreaterThan(45);
    expect(p.x).toBeLessThanOrEqual(50);
    expect(p.y).toBe(30);

    // 右下へ動かすと手前にも傾き、壁に沿って下へ。
    await page.mouse.move(...at(0.9, 0.9));
    await page.clock.runFor(400);
    const down = await ballPos(page);
    expect(down.y).toBeGreaterThan(40);

    // ボードの外（左上）へ出ても、捕まえたポインタの move はボードに届く: 左上へ傾く。
    await page.mouse.move(Math.max(1, board.x - 40), Math.max(1, board.y - 40));
    await page.clock.runFor(1000);
    const back = await ballPos(page);
    expect(back.x).toBeLessThan(down.x - 5);
    expect(back.y).toBeLessThan(down.y);

    // 離す: 委譲された onpointerup の dragEnd で操作が終わる。以後、ボタンを押さずに
    // 右下をなぞっても傾かない（dragging が残っていれば右下へ転がり出す）。
    await page.mouse.up();
    expect(await page.locator(".board").evaluate((el) => el.hasPointerCapture(1))).toBe(false);
    const released = await ballPos(page);
    await page.mouse.move(...at(0.95, 0.95));
    await page.mouse.move(...at(0.9, 0.9));
    await page.clock.runFor(1500);
    const settled = await ballPos(page);
    expect(settled.x).toBeLessThanOrEqual(released.x + 0.5);
    expect(settled.y).toBeLessThanOrEqual(released.y + 0.5);

    expect(errors).toEqual([]);
  });

  test("矢印キーの向きに盤が傾き、壁沿いにも転がる", async ({ page }) => {
    const errors = collectErrors(page);
    await openMaze(page);
    await startGame(page);

    const board = page.locator(".board");
    await board.focus();

    // → を押し続けると右へ（壁で止まる）。
    await page.keyboard.down("ArrowRight");
    await page.clock.runFor(800);
    let p = await ballPos(page);
    expect(p.x).toBeGreaterThan(45);
    expect(p.y).toBe(30);

    // ↓ も足すと壁沿いに下へ。
    await page.keyboard.down("ArrowDown");
    await page.clock.runFor(500);
    p = await ballPos(page);
    expect(p.y).toBeGreaterThan(40);
    expect(p.x).toBeGreaterThan(45);
    await page.keyboard.up("ArrowDown");
    await page.keyboard.up("ArrowRight");

    // ← は左へ（HUD の Reset で初期位置に戻してから）。
    await page.locator(".hud button").click();
    await expectBallAt(page, 30, 30);
    await board.focus();
    await page.keyboard.down("ArrowLeft");
    await page.clock.runFor(300);
    await page.keyboard.up("ArrowLeft");
    p = await ballPos(page);
    expect(p.x).toBeLessThan(30);
    expect(p.y).toBe(30);

    expect(errors).toEqual([]);
  });

  test("ボードからフォーカスが外れると、押したままのキーが解除される（onblur）", async ({ page }) => {
    const errors = collectErrors(page);
    await openMaze(page);
    await startGame(page);

    const board = page.locator(".board");
    await board.focus();

    // → を押したまま壁際へ。
    await page.keyboard.down("ArrowRight");
    await page.clock.runFor(800);
    const atWall = await ballPos(page);
    expect(atWall.x).toBeGreaterThan(45);

    // → を押したままフォーカスを HUD のボタンへ移す（onblur → keyClear）。keyup は
    // ボタンに届くので、ボードの keyUp は呼ばれない。
    await page.locator(".hud button").focus();
    await page.keyboard.up("ArrowRight");
    await page.clock.runFor(500);

    // 戻って ← を押す。→ が解除されていれば左へ転がる。残っていれば → と ← が
    // 打ち消し合って盤は水平のまま、ボールは壁際に留まる。
    await board.focus();
    await page.keyboard.down("ArrowLeft");
    await page.clock.runFor(500);
    await page.keyboard.up("ArrowLeft");
    expect((await ballPos(page)).x).toBeLessThan(atWall.x - 15);

    expect(errors).toEqual([]);
  });

  test("wake lock はプレイ中だけ取り、アイドルと落下では取らない", async ({ page }) => {
    // <wcs-wakelock> の README: `active` は「true の間だけ画面を点けたままにする」入力で、
    // 見出しの書き方が `active: isPlaying`。@wcstack/state は wc-bindable の inputs の
    // `attribute` ヒント（{ name: "active", attribute: "active" }）に値を写す。
    // 4.0.0-rc.6 まで（3.x も）boolean を String(value) で写していたので、false が
    // active="false" になり、属性の有無で判定する <wcs-wakelock> は true と読んで
    // wake lock を取っていた。今は真偽属性として写す（false は属性を外す）。
    const errors = collectErrors(page);
    await openMaze(page);
    const wakeLog = async () => (await sensorLog(page)).filter((e) => e.startsWith("wakelock"));

    // アイドル: isPlaying は false。wake lock は要求しない。
    await expect(overlayButton(page)).toHaveText("Start");
    expect(await wakeLog()).toEqual([]);
    await expect(wakeChip(page)).toHaveText("screen: normal");

    // プレイ中は取る。
    await startGame(page);
    await expect(wakeChip(page)).toHaveText("screen: kept awake");
    expect(await wakeLog()).toEqual(["wakelock.request:screen"]);

    // 落ちたら解放する。
    await tilt(page, 30, 0);
    await page.clock.runFor(2000);
    await expect(overlayTitle(page)).toHaveText("💀 Down the hole");
    await expect(wakeChip(page)).toHaveText("screen: normal");
    expect(await wakeLog()).toEqual(["wakelock.request:screen", "wakelock.release"]);

    expect(errors).toEqual([]);
  });

  test("傾きの許可が拒否されると、HUD がドラッグ／キー操作を案内する", async ({ page }) => {
    const errors = collectErrors(page);
    await openMaze(page, { tiltPermission: "denied" });
    await startGame(page);

    expect(await sensorLog(page)).toContain("tilt.requestPermission");
    await expect(controlChip(page)).toHaveText("control: drag or arrow keys (tilt permission denied)");

    // キー操作では遊べる。
    await page.locator(".board").focus();
    await page.keyboard.down("ArrowRight");
    await page.clock.runFor(500);
    await page.keyboard.up("ArrowRight");
    expect((await ballPos(page)).x).toBeGreaterThan(40);

    expect(errors).toEqual([]);
  });

  test("センサーパッケージが読み込めなくても、5 秒で Start が解放されキー操作で遊べる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.route("**/packages/tilt/dist/auto.min.js", (route) => route.abort());
    await openMaze(page);

    // <wcs-tilt> が登録されない間は pending: Start は押せない。
    await expect(overlayButton(page)).toHaveText("Loading sensors…");
    await expect(overlayButton(page)).toBeDisabled();
    await page.clock.runFor(4900);
    await expect(overlayButton(page)).toBeDisabled();

    // timeout=5000 で missing に移り、Start が解放される。
    await page.clock.runFor(200);
    await expect(overlayButton(page)).toHaveText("Start");
    await expect(overlayButton(page)).toBeEnabled();
    await expect(controlChip(page)).toHaveText("control: drag or arrow keys (sensor packages failed to load)");

    // Start の emit は登録済みの <wcs-accelerometer> にだけ届く。
    await startGame(page);
    expect((await sensorLog(page)).filter((e) => !e.startsWith("wakelock"))).toEqual(["accel.start"]);

    await page.locator(".board").focus();
    await page.keyboard.down("ArrowRight");
    await page.clock.runFor(500);
    await page.keyboard.up("ArrowRight");
    expect((await ballPos(page)).x).toBeGreaterThan(40);

    // 中断したモジュールの読み込みはブラウザ自身が console.error に出す。
    expect(errors.filter((e) => !/Failed to load resource: net::ERR_FAILED/.test(e))).toEqual([]);
  });
});
