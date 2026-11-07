import { test as base, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// examples/music-room — 中学の音楽室の練習キーボード（継ぎ目アプリ、docs/seam-apps.md の music-room）。MIDI 鍵盤・画面の
// 鍵盤・コンピューターのキーボードで 8 声のシンセ（<wcs-voice poly="8">）を弾き、ベロシティ・サステインペダル・ピッチ
// ベンド・モジュレーション・MIDI thru、先生の音（サーバー）・自分の音（このコンピューター）・音へのリンク（URL のクエリ）、
// メトロノーム・16 ステップのシーケンサー・テイクの録音と保存。公開文書だけから初めての作者が 4.16.0 で書き、4.17.0 で
// 要らなくなった回避策を外したもの: Web MIDI の無いブラウザで request() まで "prompt" だった <wcs-midi>（接続の時点で
// unsupported）、lint のためだけの定数の行・恒等の .map・$watch で写したフィールドの誤り（getter の @type と
// Array.from の行を読む）、名前空間 import の spread のための @type。
//
// この spec は作者の確認（tests/e2e の 31 件、life-events.md）を意図として固定する。MIDI 機器は無いので、作者の
// スタンドイン（examples/music-room/tests/fixtures/fake-midi.js: navigator.requestMIDIAccess と permissions.query を
// 差し替える。<wcs-midi> は本物）をページの前に入れる。「鳴った」は作者の探針（audio-probe.js: スピーカーにつながる
// ノードをすべて自分の AnalyserNode にもつなぐ。アプリのメーターも wcstack の API も使わない）で測る。4.17.0 の決定の
// うち、出口の上限 -6 dBFS と最初の操作まで AudioContext を作らないことは、ここでも固定する。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）でワーカーごとに 7500 + 10 × index のポートで立てる
// （4199–4900 / 5000–5540 / 5700– / 6100– / 7100– / 7300– は他の spec）。Firefox では走らせない: CI の Linux には
// 音の出口が無く、Firefox の AudioContext は動き出さない（audio-gesture.spec.ts と同じ）。
const PORT = 7500 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const APP = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const EXAMPLE = resolve(REPO_ROOT, "examples/music-room");
const FAKE_MIDI = readFileSync(resolve(EXAMPLE, "tests/fixtures/fake-midi.js"), "utf8");
const AUDIO_PROBE = readFileSync(resolve(EXAMPLE, "tests/fixtures/audio-probe.js"), "utf8");

declare global {
  interface Window {
    __midi: any;
    __audioProbe: { contexts(): number; state(): string[]; peak(): number };
  }
}

// 音が消えるまで（リリースの尾）待つテストがある
base.describe.configure({ timeout: 60_000 });

let server: ChildProcess;

base.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/music-room/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("music-room server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("music-room on http")) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`music-room server exited with ${code}`)); });
  });
});

// 子プロセスが終わるまで待つ: 同じワーカーで次に立てるサーバーが同じポートを使う。
base.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill();
  await exited;
});

base.beforeEach(async () => {
  const res = await fetch(APP + "/__reset", { method: "POST" });
  expect(res.status).toBe(204);
});

// --- fixtures and helpers --------------------------------------------------------------

/**
 * - ページの捕まらない例外があればテストは落ちる
 * - consoleIssues はコンソールのエラーと警告を集める（主な流れは空のままを確かめる）
 * - 音の探針をすべてのページに入れる
 */
const test = base.extend<{ consoleIssues: string[] }>({
  page: async ({ page }, use) => {
    const errors: Error[] = [];
    page.on("pageerror", (e) => errors.push(e));
    await page.addInitScript({ content: AUDIO_PROBE });
    await use(page);
    expect(errors.map((e) => e.stack ?? e.message), "uncaught page errors").toEqual([]);
  },
  consoleIssues: async ({ page }, use) => {
    const issues: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") issues.push(`${m.type()}: ${m.text()}`);
    });
    await use(issues);
  },
});

/** Web MIDI のスタンドインをページの前に入れる */
async function fakeMidi(page: Page, config: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript({ content: `window.__midiConfig = ${JSON.stringify(config)};\n${FAKE_MIDI}` });
}

const peak = (page: Page) => page.evaluate(() => window.__audioProbe.peak());
const voices = (page: Page) => page.locator("output.voices");
const pressedKeys = (page: Page, nth = 0) =>
  page.locator("mr-piano").nth(nth).evaluate((el) => [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-note].on")].map((k) => Number(k.dataset.note)));

/** アプリが読み終わるまで待つ（state が結び付き、ルーターがページを置いた） */
async function ready(page: Page, path: string): Promise<void> {
  await page.goto(APP + path);
  await expect(page.locator("main h1")).toBeVisible();
  await page.waitForFunction(() => (document.querySelector("wcs-state") as any)?.connectedCallbackPromise);
  await page.evaluate(() => (document.querySelector("wcs-state") as any).connectedCallbackPromise);
}

/** 次の `times` 回の `path` への要求を `status` で失敗させる */
async function failNext(path: string, status = 500, times = 1): Promise<void> {
  const res = await fetch(APP + "/api/_test/fail", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, status, times }),
  });
  expect(res.status).toBe(204);
}

// ヘッドレスの Chromium はタブを隠さない（別のページを前に出しても visible のまま）ので、ブラウザが知らせる形で真似る。
const hideTab = (page: Page) => page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  document.dispatchEvent(new Event("visibilitychange"));
});
const showTab = (page: Page) => page.evaluate(() => {
  delete (document as any).visibilityState;
  delete (document as any).hidden;
  document.dispatchEvent(new Event("visibilitychange"));
});
async function midiReady(page: Page, devices: Record<string, unknown>[] = [{ id: "in-1", name: "Keystation 49" }], path = "/play"): Promise<void> {
  await fakeMidi(page, { permission: "granted", devices });
  await ready(page, path);
  await page.getByRole("button", { name: "MIDI キーボードをつなぐ" }).click();
  await expect(page.locator(".midi-status")).not.toContainText("押してください");
}

// --- the main flows ----------------------------------------------------------------------

test.describe("主な流れ", () => {
  test("コンピューターのキーボードで弾いた音が本当に鳴る（最初の押鍵が音を始める操作）", async ({ page, consoleIssues }) => {
    await ready(page, "/play");
    // 操作の前はブラウザが音を止めていて、ページがそう言う
    await expect(page.locator(".banner.warn").first()).toBeVisible();
    expect(await peak(page)).toBe(0);

    await page.keyboard.down("KeyA");
    await expect.poll(() => peak(page), { message: "スピーカーに信号が届く" }).toBeGreaterThan(0.01);
    await expect(voices(page)).toHaveText("1");
    expect(await pressedKeys(page)).toEqual([60]);
    await expect(page.locator(".banner.warn").first()).toBeHidden();
    await expect.poll(() => page.locator("meter.level").evaluate((m: HTMLMeterElement) => m.value)).toBeGreaterThan(0);

    await page.keyboard.up("KeyA");
    expect(await pressedKeys(page)).toEqual([]);
    await expect(voices(page)).toHaveText("0", { timeout: 15_000 });
    await expect.poll(() => peak(page), { timeout: 15_000 }).toBeLessThan(0.001);
    expect(consoleIssues).toEqual([]);
  });

  test("MIDI の和音をサステインペダルで保つ（Web MIDI のスタンドイン）", async ({ page, consoleIssues }) => {
    await fakeMidi(page, { permission: "prompt", devices: [{ id: "in-1", name: "Keystation 49" }] });
    await ready(page, "/play");
    await page.getByRole("button", { name: "MIDI キーボードをつなぐ" }).click();
    await expect(page.locator(".midi-status")).toContainText("1 台");

    await page.evaluate(() => {
      window.__midi.cc("in-1", 64, 127);              // ペダルを踏む
      for (const n of [60, 64, 67]) window.__midi.noteOn("in-1", n, 100);
    });
    await expect(voices(page)).toHaveText("3");
    await expect.poll(() => peak(page)).toBeGreaterThan(0.01);
    await page.evaluate(() => {
      window.__midi.noteOff("in-1", 60);
      window.__midi.send("in-1", [0x90, 64, 0]);      // ノートオフをベロシティ 0 のノートオンで送る鍵盤
      window.__midi.noteOff("in-1", 67);
    });
    await page.waitForTimeout(300);
    expect(await pressedKeys(page)).toEqual([60, 64, 67]); // ペダルが保つ
    await expect(voices(page)).toHaveText("3");

    await page.evaluate(() => {                         // ペダルを踏んだまま次の和音
      for (const n of [62, 65]) window.__midi.noteOn("in-1", n, 60);
    });
    expect(await pressedKeys(page)).toEqual([60, 62, 64, 65, 67]);

    await page.evaluate(() => {
      window.__midi.noteOff("in-1", 62); window.__midi.noteOff("in-1", 65);
      window.__midi.cc("in-1", 64, 0);                 // ペダルを上げる
    });
    expect(await pressedKeys(page)).toEqual([]);
    await expect(voices(page)).toHaveText("0", { timeout: 15_000 });
    expect(consoleIssues).toEqual([]);
  });

  test("音へのリンクは再読み込みしても同じ音になる", async ({ page, consoleIssues }) => {
    const link = "/play?wave=square&detune=12&cutoff=1800&resonance=3.5&attack=0.05&decay=0.4&sustain=0.7&release=1.2&vibratoRate=6&delayMix=0.35&volume=0.6";
    await ready(page, link);
    await expect(page.locator("#c-wave")).toHaveValue("square");
    await expect(page.locator("#c-cutoff")).toHaveValue("1800");
    await expect(page.locator("#c-release")).toHaveValue("1.2");

    await page.locator("#c-resonance").fill("7.5");   // つまみを回すと URL がついてくる
    await expect(page).toHaveURL(/resonance=7\.5/);
    await expect(page).toHaveURL(/cutoff=1800/);
    await page.reload();
    await expect(page.locator("main h1")).toHaveText("弾く");
    await expect(page.locator("#c-wave")).toHaveValue("square");
    await expect(page.locator("#c-resonance")).toHaveValue("7.5");
    await expect(page.locator("#c-cutoff")).toHaveValue("1800");
    await expect(page.locator("#c-delay")).toHaveValue("0.35");
    await expect(page.locator(".sound-link")).toHaveValue(/wave=square.*resonance=7\.5/);
    expect(consoleIssues).toEqual([]);
  });

  test("シーケンサーが進み、動いている間にテンポを変えられる", async ({ page, consoleIssues }) => {
    await ready(page, "/practice");
    const cells = page.locator("button.cell");
    await expect(cells).toHaveCount(13 * 16);
    for (const [row, col] of [[12, 0], [8, 4], [5, 8], [0, 12]]) await cells.nth(row * 16 + col).click();
    await expect(page.locator("button.cell.on")).toHaveCount(4);

    const stepRate = async (ms: number) => {
      const seen = await page.evaluate(async (ms) => {
        const out: string[] = [];
        const t0 = performance.now();
        while (performance.now() - t0 < ms) {
          out.push(document.querySelector(".step-no.current")?.textContent ?? "");
          await new Promise((r) => setTimeout(r, 10));
        }
        return out;
      }, ms);
      let changes = 0;
      for (let i = 1; i < seen.length; i++) if (seen[i] !== seen[i - 1]) changes++;
      return changes / (ms / 1000);
    };

    await page.getByRole("button", { name: "シーケンサーを始める" }).click();
    await expect(page.locator(".step-no.current")).toHaveCount(1);
    await expect.poll(() => peak(page)).toBeGreaterThan(0.01);
    const before = await stepRate(1500);              // 100 BPM: 毎秒 6.7 ステップ

    await page.locator(".bpm-number").fill("180");    // 動いている間にテンポを変える
    await page.locator(".bpm-number").press("Tab");
    await expect(page.locator("#bpm")).toHaveValue("180");
    const after = await stepRate(1500);               // 180 BPM: 毎秒 12 ステップ
    expect(after).toBeGreaterThan(before * 1.5);
    await expect(page.getByRole("button", { name: "シーケンサーを止める" })).toBeVisible();

    await page.getByRole("button", { name: "シーケンサーを止める" }).click();
    await expect(page.locator(".step-no.current")).toHaveCount(0);
    expect(consoleIssues).toEqual([]);
  });

  test("テイクを録音し、保存し、再生する", async ({ page, consoleIssues }) => {
    await ready(page, "/practice");
    await expect(page.locator(".take-item")).not.toHaveCount(0);
    await page.getByRole("button", { name: "録音する" }).click();
    await expect(page.getByRole("button", { name: "メトロノームを止める" })).toBeVisible();
    for (const key of ["KeyA", "KeyD", "KeyG"]) {
      await page.keyboard.down(key);
      await page.waitForTimeout(150);
      await page.keyboard.up(key);
      await page.waitForTimeout(100);
    }
    await expect(page.locator(".rec-count")).toHaveText("6");
    await page.getByRole("button", { name: "録音を止める" }).click();
    await expect(page.locator(".draft")).toBeVisible();

    const name = "テスト録音";
    await page.locator(".take-name").fill(name);
    await page.getByRole("button", { name: "サーバーに保存する" }).click();
    await expect(page.locator(".take-saved")).toContainText(name);
    const item = page.locator(".take-item", { hasText: name });
    await expect(item).toHaveCount(1);

    await page.getByRole("button", { name: "メトロノームを止める" }).click();
    await item.getByRole("button", { name: "開く" }).click();
    await expect(page.locator(".opened strong")).toHaveText(name);
    await page.getByRole("button", { name: "再生する" }).click();
    await expect(page.locator(".playing")).toBeVisible();
    // 録った 3 つの音を順に、画面の鍵盤とスピーカーで
    const heard = new Set<number>();
    await expect.poll(async () => {
      for (const n of await pressedKeys(page)) heard.add(n);
      return [...heard].sort();
    }, { timeout: 5000, intervals: [20] }).toEqual([60, 64, 67]);
    expect(await peak(page)).toBeGreaterThan(0.001);
    await expect(page.locator(".playing")).toBeHidden({ timeout: 5000 });
    expect(consoleIssues).toEqual([]);
  });

  test("設定は再読み込みしても残る", async ({ page, consoleIssues }) => {
    await ready(page, "/settings");
    await page.locator(".qwerty-toggle").uncheck();
    await page.locator(".click-toggle").uncheck();
    await page.locator("#s-master").fill("0.3");
    await page.reload();
    await expect(page.locator("main h1")).toHaveText("設定");
    await expect(page.locator(".qwerty-toggle")).not.toBeChecked();
    await expect(page.locator(".click-toggle")).not.toBeChecked();
    await expect(page.locator("#s-master")).toHaveValue("0.3");

    // コンピューターのキーボードを切ると、キーは何も鳴らさない
    await page.getByRole("link", { name: "弾く" }).click();
    await expect(page.locator("main h1")).toHaveText("弾く");
    await expect(page.locator("#master")).toHaveValue("0.3");
    await page.keyboard.press("KeyA");
    await page.waitForTimeout(300);
    await expect(voices(page)).toHaveText("0");
    expect(consoleIssues).toEqual([]);
  });
});

// --- what 4.17.0 decided (docs/v4-direction-2026-10.md §5.13) ---------------------------

test.describe("4.17.0 の決定", () => {
  test("最初の操作まで AudioContext を作らず、読み込みではコンソールに何も出ない", async ({ page, consoleIssues }) => {
    await ready(page, "/play");
    await page.waitForTimeout(500);
    // 4.16 は接続の時点で作り、Chromium も Firefox も読み込みのたびに警告した
    expect(await page.evaluate(() => window.__audioProbe.contexts())).toBe(0);
    expect(consoleIssues).toEqual([]);
    await page.keyboard.down("KeyA");
    await expect.poll(() => peak(page)).toBeGreaterThan(0.01);
    expect(await page.evaluate(() => window.__audioProbe.contexts())).toBe(1);
    await page.keyboard.up("KeyA");
    expect(consoleIssues).toEqual([]);
  });

  test("8 声の和音を音量いっぱい・ベロシティ 127 で鳴らしても、出口は -6 dBFS を超えない", async ({ page }) => {
    // 4.16 のリミッターは threshold だけのコンプレッサーで、README の 8 声のパッチが既定の音量で +5 dBFS を出した
    await midiReady(page, undefined, "/play?wave=sawtooth&detune=0&cutoff=12000&resonance=1&attack=0&decay=2&sustain=1&release=0.1&vibratoRate=5&delayMix=0&volume=1");
    await page.locator("#master").fill("1");
    await page.evaluate(() => { for (const n of [48, 52, 55, 60, 64, 67, 72, 76]) window.__midi.noteOn("in-1", n, 127); });
    await expect(voices(page)).toHaveText("8");
    let loudest = 0;
    for (let i = 0; i < 30; i++) {
      loudest = Math.max(loudest, await peak(page));
      await page.waitForTimeout(50);
    }
    expect(loudest, "鳴っている").toBeGreaterThan(0.2);
    expect(loudest, "-6 dBFS（0.501）以下").toBeLessThanOrEqual(0.502);
    await page.evaluate(() => { for (const n of [48, 52, 55, 60, 64, 67, 72, 76]) window.__midi.noteOff("in-1", n); });
  });

  test("このコンピューターに残った古い音（delayMix がない）も既定のエコーで鳴らし、何も警告しない", async ({ page, consoleIssues }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem("music-room.sounds")) return;
      localStorage.setItem("music-room.sounds", JSON.stringify([{
        id: "my-old", name: "去年の音",
        values: { wave: "triangle", detune: 6, cutoff: 900, resonance: 1, attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.4, vibratoRate: 5, volume: 0.8 },
      }]));
    });
    await ready(page, "/sounds");
    await page.locator(".my-sounds .sound-item", { hasText: "去年の音" }).getByRole("button", { name: "この音で弾く" }).click();
    await expect(page.locator("main h1")).toHaveText("弾く");
    await expect(page.locator("#c-cutoff")).toHaveValue("900");
    await expect(page.locator("#c-delay")).toHaveValue("0.2");
    await expect(page).toHaveURL(/delayMix=0\.2/);
    await page.keyboard.down("KeyA");
    await expect(voices(page)).toHaveText("1");
    await page.keyboard.up("KeyA");
    expect(consoleIssues).toEqual([]);
  });
});

// --- things that happen in real use (life-events.md) ------------------------------------

test.describe("押さえたままの音", () => {
  test("コンピューターのキーを押さえたままウィンドウのフォーカスが外れる", async ({ page, consoleIssues }) => {
    await ready(page, "/play");
    await page.keyboard.down("KeyA");
    await expect(voices(page)).toHaveText("1");
    await page.evaluate(() => window.dispatchEvent(new Event("blur"))); // 生徒が別のウィンドウを押した
    expect(await pressedKeys(page)).toEqual([]);
    await expect(voices(page)).toHaveText("0", { timeout: 15_000 });
    await page.keyboard.up("KeyA"); // keyup は後から別の所で来る: 何も起きない
    await page.keyboard.down("KeyA"); // そのキーはまたふつうに鳴る
    await expect(voices(page)).toHaveText("1");
    await page.keyboard.up("KeyA");
    expect(consoleIssues).toEqual([]);
  });

  test("タブが隠れる（MIDI のキーと画面のキーを押さえたまま）", async ({ page }) => {
    await midiReady(page);
    await page.evaluate(() => window.__midi.noteOn("in-1", 60));
    const key = page.locator("mr-piano").first().locator('[data-note="64"]');
    const box = (await key.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 10);
    await page.mouse.down();
    await expect(voices(page)).toHaveText("2");
    await hideTab(page);
    expect(await pressedKeys(page)).toEqual([]);
    await expect(voices(page)).toHaveText("0", { timeout: 15_000 });
    await showTab(page);
    await page.mouse.up();
    await page.evaluate(() => window.__midi.noteOff("in-1", 60));
    await expect(voices(page)).toHaveText("0");
  });

  test("別のページへ行って戻る", async ({ page }) => {
    await ready(page, "/play");
    await page.keyboard.down("KeyD");
    await expect(voices(page)).toHaveText("1");
    await page.getByRole("link", { name: "練習" }).click();
    await expect(page.locator("main h1")).toHaveText("練習");
    await expect.poll(() => peak(page), { timeout: 15_000 }).toBeLessThan(0.001);
    await page.keyboard.up("KeyD");
    await page.getByRole("link", { name: "弾く" }).click();
    await expect(voices(page)).toHaveText("0");
    expect(await pressedKeys(page)).toEqual([]);
  });

  test("MIDI キーボードを抜く（キーとペダルを押さえたまま）", async ({ page }) => {
    await midiReady(page);
    await page.evaluate(() => { window.__midi.cc("in-1", 64, 127); window.__midi.noteOn("in-1", 60); window.__midi.noteOn("in-1", 64); });
    await expect(voices(page)).toHaveText("2");
    await page.evaluate(() => window.__midi.unplug("in-1"));
    expect(await pressedKeys(page)).toEqual([]);
    await expect(voices(page)).toHaveText("0", { timeout: 15_000 });
    await expect(page.locator(".midi-status")).toContainText("つないでください");
    // 挿し直すと、また鳴り、ペダルは上がっている
    await page.evaluate(() => window.__midi.plug({ id: "in-1", name: "Keystation 49" }));
    await page.evaluate(() => { window.__midi.noteOn("in-1", 67); window.__midi.noteOff("in-1", 67); });
    await expect(voices(page)).toHaveText("0", { timeout: 15_000 });
  });
});

test.describe("音", () => {
  test("離す前に同じ音をもう一度押す", async ({ page }) => {
    await midiReady(page);
    await page.evaluate(() => { window.__midi.noteOn("in-1", 60); window.__midi.noteOn("in-1", 60); });
    await expect(voices(page)).toHaveText("1");
    await page.keyboard.down("KeyA"); // 同じ C4 をコンピューターのキーボードから
    await expect(voices(page)).toHaveText("1");
    await page.evaluate(() => window.__midi.noteOff("in-1", 60));
    expect(await pressedKeys(page)).toEqual([60]); // まだコンピューターのキーボードが押さえている
    await page.keyboard.up("KeyA");
    expect(await pressedKeys(page)).toEqual([]);
    await expect(voices(page)).toHaveText("0", { timeout: 15_000 });
  });

  test("10 音を一度に（8 声より多い）", async ({ page }) => {
    await midiReady(page);
    await page.evaluate(() => { for (let n = 60; n < 70; n++) window.__midi.noteOn("in-1", n); });
    await expect(voices(page)).toHaveText("8");
    expect((await pressedKeys(page)).length).toBe(10);
    await page.evaluate(() => { for (let n = 60; n < 70; n++) window.__midi.noteOff("in-1", n); });
    await expect(voices(page)).toHaveText("0", { timeout: 15_000 });
    await expect.poll(() => peak(page), { timeout: 15_000 }).toBeLessThan(0.001);
  });
});

test.describe("MIDI の機器と許可", () => {
  test("ページを開いている間に鍵盤を挿す", async ({ page }) => {
    await midiReady(page, []);
    await expect(page.locator(".midi-status")).toContainText("つないでください");
    await page.evaluate(() => window.__midi.plug({ id: "late", name: "microKEY" }));
    await expect(page.locator(".midi-status")).toContainText("1 台");
    await page.evaluate(() => window.__midi.noteOn("late", 72));
    await expect(voices(page)).toHaveText("1");
    await page.evaluate(() => window.__midi.noteOff("late", 72));
  });

  test("許可を断ってから許す", async ({ page, consoleIssues }) => {
    await fakeMidi(page, { permission: "prompt", answer: "denied", devices: [{ id: "in-1", name: "K" }] });
    await ready(page, "/play");
    await page.getByRole("button", { name: "MIDI キーボードをつなぐ" }).click();
    await expect(page.locator(".midi-status")).toContainText("許可されていません");
    await page.keyboard.press("KeyA"); // ほかは動く
    // 生徒がサイトの設定で MIDI を許し、もう一度ボタンを押す
    await page.evaluate(() => { window.__midi.setAnswer("granted"); window.__midi.setPermission("prompt"); });
    await page.getByRole("button", { name: "MIDI キーボードをつなぐ" }).click();
    await expect(page.locator(".midi-status")).toContainText("1 台");
    expect(consoleIssues).toEqual([]);
  });

  test("弾いている間にサイトの設定で許可を取り消す", async ({ page }) => {
    await midiReady(page);
    await page.evaluate(() => { window.__midi.noteOn("in-1", 60); window.__midi.cc("in-1", 64, 127); });
    await expect(voices(page)).toHaveText("1");
    await page.evaluate(() => window.__midi.setPermission("denied"));
    await expect(page.locator(".midi-status")).toContainText("許可されていません");
    expect(await pressedKeys(page)).toEqual([]);
    await expect(voices(page)).toHaveText("0", { timeout: 15_000 });
  });

  test("Web MIDI の無いブラウザでは、最初から使えないと言いボタンを出さない（回避策なしで — 4.17）", async ({ page, consoleIssues }) => {
    // 4.16 の <wcs-midi> は request() まで "prompt" と言い、作者は接続時に request() を出していた
    await page.addInitScript(() => { delete (Navigator.prototype as any).requestMIDIAccess; });
    await ready(page, "/play");
    await expect(page.locator(".midi-status")).toContainText("使えません");
    await expect(page.getByRole("button", { name: "MIDI キーボードをつなぐ" })).toBeHidden();
    await page.keyboard.down("KeyA");
    await expect(voices(page)).toHaveText("1");
    await page.keyboard.up("KeyA");
    expect(consoleIssues).toEqual([]);
  });
});

test.describe("鳴っている間のつまみ", () => {
  test("和音が鳴っている間につまみを回し、波形を変えても、音は続く", async ({ page }) => {
    await midiReady(page);
    await page.evaluate(() => { for (const n of [60, 64, 67]) window.__midi.noteOn("in-1", n); });
    await expect(voices(page)).toHaveText("3");
    for (const v of ["400", "6000", "1200"]) await page.locator("#c-cutoff").fill(v);
    await page.locator("#c-wave").selectOption("square");
    await page.locator("#c-detune").fill("40");
    await page.waitForTimeout(200);
    await expect(voices(page)).toHaveText("3");
    await expect.poll(() => peak(page)).toBeGreaterThan(0.01);
    await page.evaluate(() => { for (const n of [60, 64, 67]) window.__midi.noteOff("in-1", n); });
  });

  test("全体の音量を 0 にして戻す", async ({ page }) => {
    await midiReady(page);
    await page.evaluate(() => window.__midi.noteOn("in-1", 60));
    await expect.poll(() => peak(page)).toBeGreaterThan(0.01);
    await page.locator("#master").fill("0");
    await expect.poll(() => peak(page)).toBeLessThan(0.0005);
    await page.locator("#master").fill("0.8");
    await expect.poll(() => peak(page)).toBeGreaterThan(0.01);
    await page.evaluate(() => window.__midi.noteOff("in-1", 60));
  });
});

test.describe("練習", () => {
  test("シーケンサーの間にテンポを速く何度も変える。別のページへ行くと止まる", async ({ page, consoleIssues }) => {
    await ready(page, "/practice");
    await page.locator("button.cell").nth(12 * 16).click();
    await page.getByRole("button", { name: "シーケンサーを始める" }).click();
    for (let i = 0; i < 30; i++) await page.locator("#bpm").fill(String(40 + ((i * 37) % 168)));
    await expect(page.locator(".step-no.current")).toHaveCount(1);
    const a = await page.locator(".step-no.current").textContent();
    await page.waitForTimeout(400);
    expect(await page.locator(".step-no.current").textContent()).not.toBe(a);
    await page.getByRole("link", { name: "弾く" }).click();
    await expect.poll(() => peak(page), { timeout: 15_000 }).toBeLessThan(0.001);
    await page.getByRole("link", { name: "練習" }).click();
    await expect(page.getByRole("button", { name: "シーケンサーを始める" })).toBeVisible();
    expect(consoleIssues).toEqual([]);
  });

  test("タブが隠れてもシーケンサーと再生中のテイクは進む（真似た隠れ方）", async ({ page }) => {
    await ready(page, "/practice");
    await page.locator("button.cell").nth(12 * 16).click();
    await page.getByRole("button", { name: "シーケンサーを始める" }).click();
    await page.locator(".take-item").first().getByRole("button", { name: "開く" }).click();
    await page.getByRole("button", { name: "再生する" }).click();
    await hideTab(page);
    const before = await page.locator(".step-no.current").textContent();
    await page.waitForTimeout(700);
    expect(await page.locator(".step-no.current").textContent()).not.toBe(before);
    await showTab(page);
    await page.getByRole("button", { name: "シーケンサーを止める" }).click();
  });
});

test.describe("サイト", () => {
  test("弾くページを 2 つのタブで開く", async ({ page, context }) => {
    await ready(page, "/play");
    const second = await context.newPage();
    await second.goto(APP + "/play");
    await expect(second.locator("main h1")).toHaveText("弾く");
    await second.keyboard.down("KeyA");
    await expect(voices(second)).toHaveText("1");
    await expect(voices(page)).toHaveText("0"); // キーはフォーカスのあるタブへ
    await second.keyboard.up("KeyA");
    // 片方で変えた設定はもう片方に届く（localStorage と <wcs-storage>）
    await second.locator("#master").fill("0.25");
    await expect(page.locator("#master")).toHaveValue("0.25");
    await second.close();
  });

  test("オフラインになって戻る", async ({ page, context }) => {
    await ready(page, "/sounds");
    await context.setOffline(true);
    await expect(page.locator(".banner", { hasText: "インターネット" })).toBeVisible();
    await page.getByRole("link", { name: "練習" }).click();
    await page.getByRole("button", { name: "録音する" }).click();
    await page.keyboard.press("KeyA");
    await page.getByRole("button", { name: "録音を止める" }).click();
    await page.getByRole("button", { name: "メトロノームを止める" }).click();
    await page.locator(".take-name").fill("オフラインのテスト");
    await page.locator(".save-take").click();
    await expect(page.locator(".take-save-error")).toContainText("つながりませんでした");
    await context.setOffline(false);
    await expect(page.locator(".banner", { hasText: "インターネット" })).toBeHidden();
    await page.locator(".save-take").click();
    await expect(page.locator(".take-saved")).toContainText("オフラインのテスト");
  });

  test("/ は弾くページへ、知らないページはそう言い、どのページも h1 は 1 つで題名がある", async ({ page, consoleIssues }) => {
    await ready(page, "/");
    await expect(page).toHaveURL(/\/play\?wave=/);
    for (const [path, h1, title] of [
      ["/play", "弾く", "弾く — 音楽室のキーボード"],
      ["/sounds", "音をえらぶ", "音をえらぶ — 音楽室のキーボード"],
      ["/sounds/2", "オルガン", "オルガン"],
      ["/practice", "練習", "練習 — 音楽室のキーボード"],
      ["/settings", "設定", "設定 — 音楽室のキーボード"],
      ["/nowhere", "ページが見つかりません", "ページが見つかりません — 音楽室のキーボード"],
    ]) {
      await ready(page, path);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toHaveText(h1);
      await expect(page).toHaveTitle(title);
    }
    expect(consoleIssues).toEqual([]);
  });

  test("スキップリンクで本文にフォーカスが移る", async ({ page }) => {
    await ready(page, "/sounds");
    await page.keyboard.press("Tab");
    await expect(page.locator("a.skip")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    await expect(page).toHaveURL(/\/sounds#main$/);
  });

  test("音の一覧: 遅い・失敗する・もう一度", async ({ page }) => {
    await ready(page, "/sounds?delay=1500");
    await expect(page.locator(".loading").first()).toBeVisible();
    await expect(page.locator(".teacher-sounds .sound-item")).not.toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(".loading").first()).toBeHidden();

    await failNext("/api/sounds", 500, 1);
    await ready(page, "/sounds");
    await expect(page.locator(".error-box").first()).toContainText("エラー 500");
    await page.getByRole("button", { name: "もう一度" }).first().click();
    await expect(page.locator(".error-box").first()).toBeHidden();
    await expect(page.locator(".teacher-sounds .sound-item")).not.toHaveCount(0);
  });

  test("先生の音をえらぶ。戻る・進むで音の間を行き来する", async ({ page }) => {
    await ready(page, "/sounds");
    await page.locator(".teacher-sounds .sound-item", { hasText: "オルガン" }).getByRole("button", { name: "この音で弾く" }).click();
    await expect(page.locator("main h1")).toHaveText("弾く");
    await expect(page.locator("#c-wave")).toHaveValue("square");
    await page.getByRole("link", { name: "音", exact: true }).click();
    await page.locator(".teacher-sounds .sound-item", { hasText: "シンセベース" }).getByRole("button", { name: "この音で弾く" }).click();
    await expect(page.locator("#c-cutoff")).toHaveValue("600");
    await page.goBack(); // /sounds
    await expect(page.locator("main h1")).toHaveText("音をえらぶ");
    await page.goBack(); // オルガン
    await expect(page.locator("main h1")).toHaveText("弾く");
    await expect(page.locator("#c-wave")).toHaveValue("square");
    await expect(page.locator("#c-cutoff")).toHaveValue("1800");
    await page.goForward();
    await page.goForward();
    await expect(page.locator("#c-cutoff")).toHaveValue("600");
    await expect(page.locator("#c-wave")).toHaveValue("sawtooth");
  });

  test("音のページを直接開き、2 つの間を戻る・進む", async ({ page }) => {
    await ready(page, "/sounds/3");
    await expect(page.locator("main h1")).toHaveText("ストリングス");
    await expect(page.locator("table.values")).toContainText("のこぎり波");
    await page.evaluate(() => { (document.querySelector("wcs-router") as any).navigate("/sounds/4"); });
    await expect(page.locator("main h1")).toHaveText("フルート");
    await page.goBack();
    await expect(page.locator("main h1")).toHaveText("ストリングス");
    await expect(page.locator("table.values")).toContainText("のこぎり波");
    await ready(page, "/sounds/999");
    await expect(page.locator("main")).toContainText("その音は見つかりません");
  });

  test("自分の音: このコンピューターに保存し、名前を変え、消す", async ({ page }) => {
    await ready(page, "/play?wave=triangle&cutoff=900");
    await page.locator(".local-name").fill("ぼくの音");
    await page.locator(".save-local").click();
    await expect(page.locator(".message").first()).toContainText("保存しました");
    await page.getByRole("link", { name: "音", exact: true }).click();
    const mine = page.locator(".my-sounds .sound-item");
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText("ぼくの音");
    await mine.getByRole("button", { name: "名前を変える" }).click();
    await page.locator(".rename-input").fill("わたしの音");
    await page.locator(".rename-ok").click();
    await expect(mine).toContainText("わたしの音");
    await page.reload();
    await expect(page.locator(".my-sounds .sound-item")).toContainText("わたしの音");
    await page.locator(".my-sounds .sound-item").getByRole("link", { name: "くわしく" }).click();
    await expect(page.locator("main h1")).toHaveText("わたしの音");
    await expect(page.locator("table.values")).toContainText("900 Hz");
    await page.getByRole("button", { name: "この音で弾く" }).click();
    await expect(page.locator("#c-wave")).toHaveValue("triangle");
    await page.getByRole("link", { name: "音", exact: true }).click();
    page.once("dialog", (d) => d.accept());
    await page.locator(".my-sounds .sound-item").getByRole("button", { name: "消す" }).click();
    await expect(page.locator(".my-sounds .sound-item")).toHaveCount(0);
  });

  test("先生が音を保存する: 鍵の誤り、つまみの隣に出るサーバーの誤り、成功（getter のフィールドの誤り — 4.17）", async ({ page }) => {
    await ready(page, "/play?wave=sine&cutoff=3000");
    await page.locator("summary").click();
    await page.locator("#t-name").fill("テストの音");
    await page.locator("#t-key").fill("wrong");
    await page.getByRole("button", { name: "サーバーに保存する" }).click();
    await expect(page.locator("details.teacher .error")).toContainText("鍵がちがいます");

    await page.locator("#t-key").fill("ongaku");
    await page.locator("#t-name").fill("あ".repeat(31));
    await page.getByRole("button", { name: "サーバーに保存する" }).click();
    await expect(page.locator("#t-name ~ .field-error")).toContainText("30文字");

    await page.locator("#t-name").fill("テストの音");
    await page.getByRole("button", { name: "サーバーに保存する" }).click();
    await expect(page.locator("details.teacher .message")).toContainText("保存しました");
    await expect(page.locator("#t-name ~ .field-error")).toBeHidden();
    await page.getByRole("link", { name: "音", exact: true }).click();
    await expect(page.locator(".teacher-sounds")).toContainText("テストの音");
  });

  test("サーバーが失敗している間にテイクを保存し、もう一度", async ({ page }) => {
    await ready(page, "/practice");
    await page.getByRole("button", { name: "録音する" }).click();
    await page.keyboard.press("KeyA");
    await page.getByRole("button", { name: "録音を止める" }).click();
    await page.getByRole("button", { name: "メトロノームを止める" }).click();
    await page.locator(".take-name").fill("失敗のテスト");
    await failNext("/api/takes", 503, 1);
    await page.locator(".save-take").click();
    await expect(page.locator(".take-save-error")).toContainText("エラー 503");
    await page.locator(".save-take").click();
    await expect(page.locator(".take-saved")).toContainText("失敗のテスト");
    await expect(page.locator(".take-save-error")).toBeHidden();
    await expect(page.locator(".take-item", { hasText: "失敗のテスト" })).toHaveCount(1);

    // 名前は要る
    await page.getByRole("button", { name: "録音する" }).click();
    await page.keyboard.press("KeyS");
    await page.getByRole("button", { name: "録音を止める" }).click();
    await page.locator(".save-take").click();
    await expect(page.locator(".draft .field-error")).toContainText("名前");
  });

  test("MIDI の設定: 入力と出力は機器についてくる。出力には弾いたものが届く", async ({ page, consoleIssues }) => {
    await fakeMidi(page, {
      permission: "granted",
      devices: [
        { id: "in-a", name: "Keystation 49" }, { id: "in-b", name: "Keystation 49" },
        { id: "out-1", name: "SC-8850", type: "output" },
      ],
    });
    await ready(page, "/settings");
    await page.getByRole("button", { name: "MIDI キーボードをつなぐ" }).click();
    await expect(page.locator("#midi-in option")).toHaveText(["つながっているすべてのキーボード", "Keystation 49 (1)", "Keystation 49 (2)"]);
    await page.evaluate(() => window.__midi.plug({ id: "in-c", name: "microKEY" }));
    await expect(page.locator("#midi-in option")).toHaveCount(4);
    await page.locator("#midi-in").selectOption("in-b");
    await page.locator("#midi-out").selectOption("out-1");
    await page.reload();
    await expect(page.locator("#midi-in")).toHaveValue("in-b");
    await expect(page.locator("#midi-out")).toHaveValue("out-1");
    await page.getByRole("link", { name: "弾く" }).click();
    await page.evaluate(() => { window.__midi.noteOn("in-a", 60); window.__midi.noteOn("in-b", 62); });
    await expect(voices(page)).toHaveText("1"); // えらんだ鍵盤だけが鳴る
    await page.evaluate(() => window.__midi.noteOff("in-b", 62));
    const sent = await page.evaluate(() => window.__midi.sent("out-1"));
    expect(sent).toEqual([[0x90, 62, 100], [0x80, 62, 0]]);
    expect(consoleIssues).toEqual([]);
  });
});
