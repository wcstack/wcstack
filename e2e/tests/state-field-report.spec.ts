import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/state-field-report — 現場報告（継ぎ目アプリ、docs/seam-apps.md の state-field-report）。
// permission × camera × recorder × geolocation × speech × fetch × upload × storage × network × notification ×
// router を一つのアプリで越える。主題は継ぎ目: 権限の二つの見え方（<wcs-permission> と取得する要素）、
// ルートを離れたときの I/O ノードの切断（4.5 で切断がリセットを発行する）、録画の途中で終わる取り
// （トラックの終了・ルートの離脱）、オフラインの outbox、サーバーの拒否と送り直し、半分が値・半分が
// ハンドルの下書き、Permissions-Policy / <iframe> の allow。
//
// この spec はその意図を実ブラウザで固定する: カメラとマイクは Chromium の偽デバイス（chromium-media
// プロジェクト: channel "chromium" + --use-fake-device-for-media-stream。headless shell には getUserMedia が
// 無い）、許可は context.grantPermissions / clearPermissions（ヘッドレスに許可ダイアログは出ない —
// 許可しない = 拒否）、オフラインは context.setOffline、サーバーの失敗はデモの試験用エンドポイント
// （fail-next / max-upload / reset）。カメラの「点灯」は getUserMedia の台帳（生きているトラック）で見る。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）+ CSP=1 + PP=1（本番形の CSP と
// Permissions-Policy）でワーカーごとに別ポートで立てる。アプリは localhost、埋め込む別オリジンは 127.0.0.1。
const PORT = 5100 + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const APP = `http://localhost:${PORT}`;
const OTHER = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const DEVICES = ["camera", "microphone", "screen-wake-lock"];

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/state-field-report/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", CSP: "1", PP: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error("demo server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Demo server running")) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    server.on("error", (err) => { clearTimeout(timer); rejectReady(err); });
    server.on("exit", (code) => { clearTimeout(timer); rejectReady(new Error(`demo server exited with ${code}`)); });
  });
});

// 子プロセスが終わるまで待つ: 同じワーカーで次に立てるサーバーが同じポートを使う。
test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill();
  await exited;
});

test.beforeEach(async () => {
  expect((await api("POST", "/api/test/reset")).status).toBe(200);
});

// --- helpers -------------------------------------------------------------------

async function api(method: string, path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(APP + path, { method });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** getUserMedia の台帳: 生きているトラックの種類（ハードウェアのインジケーター代わり） */
const LEDGER = () => {
  const md = navigator.mediaDevices;
  (window as any).__streams = [];
  if (!md?.getUserMedia) return;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    const s = await orig(c);
    (window as any).__streams.push(s);
    return s;
  };
};
const liveTracks = (page: Page) => page.evaluate(() =>
  ((window as any).__streams as MediaStream[]).flatMap((s) => s.getTracks()).filter((t) => t.readyState === "live").map((t) => t.kind).sort());

/** console.error / pageerror / console.warning を集める。HTTP の失敗を見せるテストは allow で期待する行を外す */
function collectConsole(page: Page): string[] {
  const messages = collectErrors(page);
  page.on("console", (msg) => {
    if (msg.type() === "warning") messages.push(`console.warn: ${msg.text()}`);
  });
  return messages;
}
const unexpected = (messages: string[], ...allow: RegExp[]) => messages.filter((m) => !allow.some((re) => re.test(m)));
const httpError = (status: number) => new RegExp(`Failed to load resource: the server responded with a status of ${status}`);

async function open(page: Page, path: string): Promise<void> {
  await page.addInitScript(LEDGER);
  await page.goto(APP + path);
  await page.waitForFunction(() => !!customElements.get("wcs-state") && !!customElements.get("wcs-router"));
  await page.evaluate(() => (document.querySelector("wcs-state") as any).connectedCallbackPromise);
}

async function grant(context: BrowserContext, ...extra: string[]): Promise<void> {
  await context.grantPermissions([...DEVICES, ...extra], { origin: APP });
}

async function startCamera(page: Page): Promise<void> {
  await page.locator("#cam-start").click();
  await expect(page.locator("#cam-status")).toHaveText("Camera live.");
}

async function record(page: Page, ms: number): Promise<void> {
  const before = await page.locator(".clip-card").count();
  await page.locator("#rec-start").click();
  await expect(page.locator("#rec-indicator")).toBeVisible();
  await page.waitForTimeout(ms);
  await page.locator("#rec-stop").click();
  await expect(page.locator(".clip-card")).toHaveCount(before + 1);
}

/** それぞれの <video> が読めるか（読み込めた = true） */
const playable = (page: Page) => page.$$eval("video.clip", (vs) => Promise.all((vs as HTMLVideoElement[]).map((v) => new Promise<boolean>((ok) => {
  if (v.readyState >= 1) return ok(true);
  v.addEventListener("loadedmetadata", () => ok(true), { once: true });
  v.addEventListener("error", () => ok(false), { once: true });
  v.load();
  setTimeout(() => ok(false), 5000);
}))));

/** 下書きの最初のクリップの大きさ（state から — 画面は kB に丸める） */
const clipSize = (page: Page) => page.evaluate(async () => {
  let size = 0;
  await (document.querySelector("wcs-state") as any).createStateAsync("readonly", async (s: any) => { size = s.clips[0]?.size ?? 0; });
  return size;
});

const nav = (page: Page, label: string) => page.locator("header nav").getByText(label, { exact: true }).click();

// --- tests ---------------------------------------------------------------------

test.describe("state-field-report — カメラとルート", () => {
  test("/new を離れるとカメラは止まり、戻ると Camera off. で Start が押せる（F9 の回帰）", async ({ page, context }) => {
    const messages = collectConsole(page);
    await grant(context);
    await open(page, "/new");
    await startCamera(page);
    expect(await liveTracks(page)).toEqual(["audio", "video"]);

    await nav(page, "Permissions");
    await expect(page).toHaveURL(`${APP}/permissions`);
    expect(await liveTracks(page)).toEqual([]);               // 他のページでカメラは消えている

    await page.goBack();
    await expect(page).toHaveURL(`${APP}/new`);
    // 4.4 では cam.active が true のまま残り "Camera live." と Start の無効化が続いた
    await expect(page.locator("#cam-status")).toHaveText("Camera off.");
    await expect(page.locator("#cam-start")).toBeEnabled();
    await expect(page.locator("#rec-start")).toBeDisabled();
    await startCamera(page);
    expect(await liveTracks(page)).toEqual(["audio", "video"]);

    await page.goForward();
    expect(await liveTracks(page)).toEqual([]);
    expect(messages).toEqual([]);
  });

  test("録画中に /new を離れる: 確認のあと、それまでの録画がクリップとして届き、型も付いている", async ({ page, context }) => {
    const messages = collectConsole(page);
    const dialogs: string[] = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); void d.accept(); });
    await grant(context);
    await open(page, "/new");
    await startCamera(page);
    await page.locator("#rec-start").click();
    await expect(page.locator("#rec-indicator")).toBeVisible();
    await page.waitForTimeout(1200);

    await nav(page, "Reports");
    await expect(page).toHaveURL(`${APP}/`);
    expect(dialogs).toEqual(["A clip is being recorded. Leaving stops it; what was recorded so far is kept. Leave?"]);
    expect(await liveTracks(page)).toEqual([]);

    await page.goBack();
    // 4.4 では録画が黙って捨てられた。4.5: 離れた後に recorded が届く
    await expect(page.locator(".clip-card")).toHaveCount(1);
    await expect(page.locator(".clip-label")).toContainText("video/webm");   // mime-type 無しでも型が付く
    expect(await playable(page)).toEqual([true]);
    await expect(page.locator("#cam-status")).toHaveText("Camera off.");
    await expect(page.locator("#rec-indicator")).toBeHidden();
    expect(messages).toEqual([]);
  });

  test("録画中に権限を取り上げる: プレビューと録画は止まり、それまでのクリップは残り、理由を言う", async ({ page, context }) => {
    const messages = collectConsole(page);
    await grant(context);
    await open(page, "/new");
    await startCamera(page);
    await page.locator("#rec-start").click();
    await page.waitForTimeout(1500);

    await context.clearPermissions();                          // 録画中に取り上げる（トラックが ended）
    await expect(page.locator("#cam-notice")).toContainText("The camera stopped by itself");
    await expect(page.locator("#cam-notice")).toContainText("kept as a clip");
    await expect(page.locator(".clip-card")).toHaveCount(1);
    expect(await playable(page)).toEqual([true]);
    expect(await liveTracks(page)).toEqual([]);
    await expect(page.locator("#rec-indicator")).toBeHidden();
    await expect(page.locator("#cam-status")).toHaveText("Camera off.");
    expect(messages).toEqual([]);
  });

  test("拒否してから許可する: 再読み込み無しでバナーが変わり、もう一度 Start で動く", async ({ page, context }) => {
    const messages = collectConsole(page);
    await open(page, "/new");                                  // 何も許可していない = 拒否
    await page.locator("#cam-start").click();
    await expect(page.locator("#cam-blocked")).toBeVisible();
    await expect(page.locator("#cam-status")).toContainText("not-allowed");
    await expect(page.locator("#cam-unavailable")).toHaveCount(0);   // 拒否は「使えない」ではない

    await grant(context);                                      // サイトの設定で許可（再読み込み無し）
    await expect(page.locator("#cam-blocked")).toHaveCount(0);
    await expect(page.locator("#cam-allowed-again")).toBeVisible();
    await startCamera(page);
    await expect(page.locator("#cam-allowed-again")).toHaveCount(0);
    expect(messages).toEqual([]);
  });
});

test.describe("state-field-report — 位置", () => {
  test("位置情報を拒否 → 住所を入力 → 後で許可して位置を付ける", async ({ page, context }) => {
    const messages = collectConsole(page);
    await context.clearPermissions();                          // 最初の訪問（prompt）。ヘッドレスは聞かずに断る
    await open(page, "/new");
    await page.locator("#geo-locate").click();
    await expect(page.locator("#geo-error")).toContainText("Location refused. Type the address instead");
    await expect(page.locator("#geo-blocked")).toBeVisible();
    await expect(page.locator("label[for=f-address]")).toContainText("needed");
    await page.locator("#f-address").fill("Lot B, east corner");

    await context.grantPermissions(["geolocation"], { origin: APP });
    await context.setGeolocation({ latitude: 35.6812, longitude: 139.7671, accuracy: 18 });
    await expect(page.locator("#geo-blocked")).toHaveCount(0);
    await expect(page.locator("#geo-locate")).toBeEnabled();
    await page.locator("#geo-locate").click();
    await expect(page.locator("#geo-position")).toHaveText("35.68120, 139.76710 (±18 m)");
    await expect(page.locator("#geo-error")).toHaveText("");
    await expect(page.locator("#f-address")).toHaveValue("Lot B, east corner");
    expect(messages).toEqual([]);
  });
});

test.describe("state-field-report — 送信", () => {
  test("オフラインで送ると outbox で待ち、オンラインに戻ると報告とクリップが届く", async ({ page, context }) => {
    const messages = collectConsole(page);
    await grant(context);
    await open(page, "/new");
    await page.locator("#f-title").fill("Basement pump");
    await startCamera(page);
    await record(page, 900);

    await context.setOffline(true);
    await expect(page.locator("#net-pill")).toHaveText("offline");
    await expect(page.locator("#send-hint")).toContainText("waits in the outbox");
    await page.locator("#send").click();
    await expect(page.locator(".entry-phase")).toHaveText("queued");
    expect((await api("GET", "/api/reports")).json).toHaveLength(3);   // まだ何も届いていない

    await context.setOffline(false);
    await expect(page.locator(".entry-phase")).toHaveText("sent");
    await expect(page.locator("#sent-notice")).toHaveText('Report #4 "Basement pump" is sent with 1 clip.');
    const report = (await api("GET", "/api/reports/4")).json;
    expect(report.media).toHaveLength(1);
    expect(report.media[0].type).toMatch(/^video\/webm/);       // mime-type を付けなくても 415 にならない
    expect(messages).toEqual([]);
  });

  test("422: 題名の無い報告は下書きに戻り、題名の横に理由が出て、直すと送れる", async ({ page, context }) => {
    const messages = collectConsole(page);
    await grant(context);
    await open(page, "/new");
    await page.locator("#f-note").fill("Forgot the title");
    await page.locator("#send").click();
    await expect(page.locator(".entry-phase")).toHaveText("rejected");
    await expect(page.locator(".entry-error")).toHaveText("Refused by the server: title required");

    await page.locator(".entry-edit").click();
    await expect(page).toHaveURL(`${APP}/new`);
    await expect(page.locator("#title-error")).toHaveText("Title: required");
    await expect(page.locator("#f-note")).toHaveValue("Forgot the title");
    await page.locator("#f-title").fill("Now with a title");
    await page.locator("#send").click();
    await expect(page.locator(".entry-phase")).toHaveText("sent");
    expect(unexpected(messages, httpError(422))).toEqual([]);
  });

  test("500 と 413: 報告の作成は Retry、大きすぎるクリップは行に理由、送り直しで届く", async ({ page, context }) => {
    const messages = collectConsole(page);
    await grant(context);
    await open(page, "/new");
    await page.locator("#f-title").fill("Server trouble");
    await startCamera(page);
    await record(page, 1500);
    const size = await clipSize(page);
    expect(size).toBeGreaterThan(10_000);                      // a real take, not a header-only WebM

    await api("POST", "/api/test/fail-next?kind=create");
    await api("POST", `/api/test/max-upload?bytes=${Math.floor(size / 2)}`);
    await page.locator("#send").click();
    await expect(page.locator(".entry-phase")).toHaveText("failed");
    await expect(page.locator(".entry-error")).toHaveText("The server failed (500).");

    await page.locator(".entry-retry").click();                // 作成は通り、クリップが 413
    await expect(page.locator(".upload-phase")).toHaveText("failed: too large for the server");
    await expect(page.locator(".entry-phase")).toHaveText("incomplete");

    await api("POST", "/api/test/max-upload?bytes=2097152");
    await page.locator(".upload-retry").click();               // 使い切られた files を渡し直して送る
    await expect(page.locator(".upload-phase")).toHaveText("sent");
    await expect(page.locator(".entry-phase")).toHaveText("sent");
    expect((await api("GET", "/api/reports/4")).json.media).toHaveLength(1);
    expect(unexpected(messages, httpError(500), httpError(413))).toEqual([]);
  });

  test("415: 受け付けない型のクリップは行に理由が出る（他は送れる）", async ({ page, context }) => {
    const messages = collectConsole(page);
    await grant(context);
    await open(page, "/new");
    await page.locator("#f-title").fill("Wrong type");
    // 録画の Blob は型が付く（4.5）ので、型の違うクリップを状態に置く
    await page.evaluate(async () => {
      const el = document.querySelector("wcs-state") as any;
      await el.createStateAsync("writable", async (s: any) => {
        const blob = new Blob(["not a video"], { type: "text/plain" });
        s.clipSeq = 1;
        s.clips = s.clips.concat({ id: 1, blob, url: URL.createObjectURL(blob), mimeType: "text/plain", duration: 0, size: blob.size });
      });
    });
    await page.locator("#send").click();
    await expect(page.locator(".upload-phase")).toHaveText("failed: type not accepted");
    await expect(page.locator(".entry-phase")).toHaveText("incomplete");
    expect(unexpected(messages, httpError(415))).toEqual([]);
  });

  test("二度押し: 送信は一つの報告になる", async ({ page, context }) => {
    const messages = collectConsole(page);
    await grant(context);
    await open(page, "/new");
    await page.locator("#f-title").fill("Double click");
    await page.locator("#send").dblclick();
    await expect(page.locator(".entry-phase")).toHaveText("sent");
    expect((await api("GET", "/api/reports")).json).toHaveLength(4);
    expect(messages).toEqual([]);
  });
});

test.describe("state-field-report — 下書きとルート", () => {
  test("下書きを持って再読み込み: 文字と位置は戻り、クリップは保てなかったと言う", async ({ page, context }) => {
    const messages = collectConsole(page);
    const dialogs: string[] = [];
    page.on("dialog", (d) => { dialogs.push(d.type()); void d.accept(); });
    await grant(context, "geolocation");
    await context.setGeolocation({ latitude: 35.1, longitude: 136.9, accuracy: 25 });
    await open(page, "/new");
    await page.locator("#f-title").fill("Reload me");
    await page.locator("#f-note").fill("with a note");
    await page.locator("#geo-locate").click();
    await expect(page.locator("#geo-position")).toHaveText("35.10000, 136.90000 (±25 m)");
    await startCamera(page);
    await record(page, 800);

    await page.reload();
    await page.waitForFunction(() => !!customElements.get("wcs-state"));
    await page.evaluate(() => (document.querySelector("wcs-state") as any).connectedCallbackPromise);
    expect(dialogs).toEqual(["beforeunload"]);                 // leaveConfirm: 送っていない下書き
    await expect(page.locator("#f-title")).toHaveValue("Reload me");
    await expect(page.locator("#f-note")).toHaveValue("with a note");
    await expect(page.locator("#geo-position")).toHaveText("35.10000, 136.90000 (±25 m)");
    await expect(page.locator(".clip-card")).toHaveCount(0);
    await expect(page.locator("#lost-clips")).toContainText("1 clip recorded before the page was reloaded could not be kept");
    expect(messages).toEqual([]);
  });

  test("深いリンク /reports/3 と、無い報告 /reports/999（直接と遷移）", async ({ page }) => {
    const messages = collectConsole(page);
    await open(page, "/reports/3");
    await expect(page.locator("#report-title")).toHaveText("Scaffold inspection — tower 3");

    await open(page, "/reports/999");
    await expect(page.locator("#report-missing")).toHaveText("No report #999");

    await open(page, "/");
    await expect(page.locator(".report-item")).toHaveCount(3);
    await page.locator(".report-item a").nth(1).click();       // 新しい順: 2 番目は #2
    await expect(page).toHaveURL(`${APP}/reports/2`);
    await expect(page.locator("#report-title")).toHaveText("Drainage blocked at lot B");
    await page.evaluate(() => (document.querySelector("wcs-router") as any).navigate("/reports/999"));
    await expect(page.locator("#report-missing")).toHaveText("No report #999");
    await expect(page.locator("#report-title")).toHaveCount(0);     // 前の報告が残って見えない
    await page.goBack();
    await expect(page.locator("#report-title")).toHaveText("Drainage blocked at lot B");
    expect(unexpected(messages, httpError(404))).toEqual([]);
  });
});

test.describe("state-field-report — 別オリジンの <iframe>", () => {
  test("allow 無しで埋め込まれると、カメラと位置は『このページでは使えない』と言い、設定へは送らない", async ({ page, context }) => {
    const messages = collectConsole(page);
    // サイトとしては許可済み（アプリと埋め込む側の両方のオリジン）— それでも使えない
    await grant(context, "geolocation");
    await context.grantPermissions([...DEVICES, "geolocation"], { origin: OTHER });
    await page.addInitScript(LEDGER);
    await page.goto(`${OTHER}/embed`);
    const frame = page.frameLocator("#app");
    await expect(frame.locator("#cam-unavailable")).toContainText("The camera is not available on this page");
    await expect(frame.locator("#cam-status")).toHaveText("Not available on this page.");
    await expect(frame.locator("#cam-start")).toBeDisabled();
    await expect(frame.locator("#cam-blocked")).toHaveCount(0);     // 「サイトの設定で許可」とは言わない
    await expect(frame.locator("#geo-unavailable")).toContainText("Location is not available on this page");
    await expect(frame.locator("#geo-locate")).toBeDisabled();
    await expect(frame.locator("label[for=f-address]")).toContainText("needed");
    await expect(frame.locator("#listen-text")).toHaveText("Dictation is not available on this page — type the note.");
    // 書いて送ることはできる
    await frame.locator("#f-title").fill("From the frame");
    await frame.locator("#f-address").fill("Gate 4");
    await frame.locator("#send").click();
    await expect(frame.locator(".entry-phase")).toHaveText("sent");
    expect(messages).toEqual([]);
  });

  test("allow 無しの <iframe> の Permissions ページは camera / microphone / geolocation を unsupported と出す", async ({ page, context }) => {
    const messages = collectConsole(page);
    await grant(context, "geolocation");
    await context.grantPermissions([...DEVICES, "geolocation"], { origin: OTHER });
    await page.goto(`${OTHER}/embed?path=/permissions`);
    const frame = page.frameLocator("#app");
    await expect(frame.locator("tr.perm-row")).toHaveCount(4);
    for (const name of ["camera", "microphone", "geolocation"]) {
      await expect(frame.locator(`tr[data-perm=${name}] .perm-state`)).toHaveText("unsupported");
      await expect(frame.locator(`tr[data-perm=${name}] .perm-advice`)).toContainText("Not available on this page");
    }
    expect(messages).toEqual([]);
  });

  test("allow 付きで埋め込まれると、枠の中でカメラが動く", async ({ page, context }) => {
    const messages = collectConsole(page);
    // 委譲された権限は埋め込む側（トップレベル）のオリジンで判断される
    await context.grantPermissions(DEVICES, { origin: OTHER });
    await page.addInitScript(LEDGER);
    await page.goto(`${OTHER}/embed?allow=1`);
    const frame = page.frameLocator("#app");
    await expect(frame.locator("#cam-unavailable")).toHaveCount(0);
    await frame.locator("#cam-start").click();
    await expect(frame.locator("#cam-status")).toHaveText("Camera live.");
    expect(messages).toEqual([]);
  });
});
