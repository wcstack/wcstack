import { test, expect, type Page, type Request, type Route } from "@playwright/test";
import { collectErrors } from "./helpers";

// examples/state-camera-record-upload の実ブラウザテスト。
//
// デモは permission + camera + upload + state の一直線のパイプライン:
//   <wcs-permission name="camera"> が camPerm を書き、<wcs-camera> が getUserMedia で
//   プレビューを持ち、stream-ready の生の MediaStream を event token → $on →
//   $command.feedRecorder.emit(stream) で <wcs-recorder>.attachStream() に渡す
//   （MediaStream は state に入らない）。録画の Blob は onRecorded で File にして
//   clipFiles に入り、<wcs-upload manual> が command token で multipart POST する。
//
// このスペックが固定するもの:
//   - Start → Record → Stop → 再生プレビュー（blob: URL の webm が実際に読める）→
//     Upload（multipart の中身・進捗表示・成功表示）→ Stop camera（トラック停止）
//   - アップロード失敗の表示と、撮り直したクリップの送信（<wcs-upload> は送った files を
//     成否を問わず null に戻し、それが clipFiles に書き戻る）
//   - 撮り直しで前の blob: URL が revoke されること
//   - getUserMedia 拒否時のバナー・ピル・エラー文言
//   - keepAlive: recording（非表示で suspend、録画中は維持）。state の属性ミラーの回帰
//     （そのテストのコメント参照）
//
// プラットフォーム API の用意:
//   - カメラ: Chromium の偽デバイス（--use-fake-device-for-media-stream）と
//     許可ダイアログの自動承認（--use-fake-ui-for-media-stream）。context の
//     permissions で camera を許可済みにする（<wcs-permission> の query が granted）。
//   - MediaRecorder: 実物（偽デバイスのフレームを本当に録る）。
//   - アップロード先 https://httpbin.org/post: page.route() で横取りする。XHR に
//     upload の progress リスナーが付くので CORS のプリフライトが飛ぶ。OPTIONS にも
//     CORS ヘッダで答える。
//   - 拒否のテストだけ getUserMedia を NotAllowedError で reject する版に差し替える。

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
  permissions: ["camera"],
});

const UPLOAD_URL = "https://httpbin.org/post";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

type UploadHook = (route: Route, request: Request) => Promise<void> | void;

// httpbin.org/post を横取りする。プリフライトは常に許可し、POST は hook に渡す。
// 受けた POST を順に記録する。
async function mockUpload(page: Page, hook: UploadHook) {
  const posts: Request[] = [];
  await page.route(UPLOAD_URL, async (route, request) => {
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    posts.push(request);
    await hook(route, request);
  });
  return posts;
}

const okUpload: UploadHook = (route) =>
  route.fulfill({ status: 200, headers: CORS, json: { ok: true } });

// multipart の本文から 1 パートを取り出す（ヘッダ部と中身のバイト列）。
type Body = NonNullable<ReturnType<Request["postDataBuffer"]>>;
function parseMultipart(body: Body, contentType: string) {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) throw new Error(`no boundary in ${contentType}`);
  const delimiter = `--${boundary}`;
  const parts: { headers: string; data: Body }[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const chunk = body.subarray(start + delimiter.length + 2, next - 2); // CRLF の後〜次の区切りの前の CRLF
    const sep = chunk.indexOf("\r\n\r\n");
    parts.push({ headers: chunk.subarray(0, sep).toString("utf-8"), data: chunk.subarray(sep + 4) });
    start = next;
  }
  return parts;
}

const camera = (page: Page) => page.locator("wcs-camera");
const startBtn = (page: Page) => page.getByRole("button", { name: "▶ Start camera" });
const stopCamBtn = (page: Page) => page.getByRole("button", { name: "■ Stop camera" });
const recordBtn = (page: Page) => page.getByRole("button", { name: "● Record" });
const stopRecBtn = (page: Page) => page.getByRole("button", { name: "■ Stop", exact: true });
const uploadBtn = (page: Page) => page.getByRole("button", { name: "⤴ Upload clip" });
const camStatus = (page: Page) => page.locator("section .status").first();
const uploadStatus = (page: Page) => page.locator("video.playback + .row .status");

// カメラを起動し、内部 <video> に偽デバイスのフレームが流れるまで待つ。
// stream-ready の MediaStream を window.__stream に控える（後でトラックの停止を見る）。
async function startCamera(page: Page) {
  await camera(page).evaluate((el) => {
    el.addEventListener("wcs-camera:stream-ready", (e) => {
      (window as any).__stream = (e as CustomEvent).detail;
    });
  });
  await startBtn(page).click();
  await expect(camStatus(page)).toHaveText("Camera live.");
  await expect
    .poll(() => camera(page).evaluate((el: any) => el.videoElement.videoWidth))
    .toBeGreaterThan(0);
}

// 録画中、偽デバイスの映像が実時間で 0.6 秒以上進むのを待つ（録るものが無いと
// Blob が空になる）。目安はカメラ自身のプレビューの currentTime。Chromium は画面外の
// ミュート自動再生の <video> を止めるので、先にプレビューを画面内へ戻す。
async function waitForRecordedFrames(page: Page) {
  await camera(page).scrollIntoViewIfNeeded();
  const t0 = await camera(page).evaluate((el: any) => el.videoElement.currentTime);
  await expect
    .poll(() => camera(page).evaluate((el: any) => el.videoElement.currentTime))
    .toBeGreaterThan(t0 + 0.6);
}

// 録画して止め、再生プレビューが出るまで進める。
async function recordClip(page: Page) {
  await recordBtn(page).click();
  await expect(page.locator(".rec")).toBeVisible();
  await waitForRecordedFrames(page);
  await stopRecBtn(page).click();
  await expect(page.locator("video.playback")).toBeVisible();
}

test.describe("examples/state-camera-record-upload", () => {
  test("起動 → 録画 → 停止 → プレビュー → アップロード → カメラ停止", async ({ page }) => {
    const errors = collectErrors(page);
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((r) => (releaseUpload = r));
    const posts = await mockUpload(page, async (route) => {
      await uploadGate;
      await okUpload(route, route.request());
    });
    await page.goto("/examples/state-camera-record-upload/");

    // 初期: <wcs-permission> の query が granted を書き、ピルの文言と色クラスが揃う。
    const pill = page.locator(".pill");
    await expect(pill).toHaveText("granted");
    await expect(pill).toHaveClass(/\bgranted\b/);
    await expect(pill).not.toHaveClass(/\bprompt\b/);
    await expect(page.locator(".banner")).toHaveCount(0);
    await expect(camStatus(page)).toHaveText("Camera off.");
    await expect(stopCamBtn(page)).toBeHidden();
    await expect(recordBtn(page)).toBeDisabled();
    await expect(page.locator(".rec")).toBeHidden();
    await expect(page.locator("video.playback")).toHaveCount(0);

    // 起動: active が true になり、ボタンが入れ替わり、Record が押せる。
    await startCamera(page);
    await expect(startBtn(page)).toBeHidden();
    await expect(stopCamBtn(page)).toBeVisible();
    await expect(recordBtn(page)).toBeEnabled();
    // MediaStream は state を通らず、カメラ自身の <video> にだけ入る。
    expect(
      await camera(page).evaluate((el: any) => el.videoElement.srcObject === (window as any).__stream),
    ).toBe(true);

    // 録画中: REC と Stop が出て、Record は隠れる。duration は停止まで "—"。
    await recordBtn(page).click();
    await expect(page.locator(".rec")).toBeVisible();
    await expect(stopRecBtn(page)).toBeVisible();
    await expect(recordBtn(page)).toBeHidden();
    await expect(page.locator(".rec + .status")).toHaveText("—");
    await waitForRecordedFrames(page);

    // 停止: duration が確定し、再生プレビューが blob: URL で出る。
    await stopRecBtn(page).click();
    await expect(page.locator(".rec")).toBeHidden();
    await expect(recordBtn(page)).toBeVisible();
    const durationText = await page.locator(".rec + .status").textContent();
    expect(durationText).toMatch(/^\d+\.\ds$/);
    expect(parseFloat(durationText!)).toBeGreaterThanOrEqual(0.5);

    const playback = page.locator("video.playback");
    await expect(playback).toBeVisible();
    await expect(playback).toHaveAttribute("src", /^blob:/);
    // 録れた webm が実際にデコードできる（メタデータが読める）。
    await expect.poll(() => playback.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
    await expect(uploadStatus(page)).toHaveText("Ready to upload.");
    await expect(uploadBtn(page)).toBeEnabled();

    // プレビューの Blob（= clipFiles の File の中身）の大きさを控える。
    const clip = await playback.evaluate(async (v: HTMLVideoElement) => {
      const blob = await (await fetch(v.src)).blob();
      return { size: blob.size, type: blob.type };
    });
    expect(clip.size).toBeGreaterThan(0);
    expect(clip.type).toMatch(/^video\/webm/);

    // アップロード: 応答を保留している間は進捗付きの Uploading… を出す。
    await uploadBtn(page).click();
    await expect(uploadStatus(page)).toHaveText(/^Uploading… \d+%$/);
    await expect.poll(() => posts.length).toBe(1);

    // 送られたもの: POST、multipart/form-data、フィールド名 clip の webm 1 本。
    const request = posts[0];
    expect(request.method()).toBe("POST");
    const contentType = (await request.allHeaders())["content-type"];
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    const parts = parseMultipart(request.postDataBuffer()!, contentType);
    expect(parts).toHaveLength(1);
    expect(parts[0].headers).toMatch(/Content-Disposition: form-data; name="clip"; filename="clip-\d+\.webm"/);
    expect(parts[0].headers).toMatch(/Content-Type: video\/webm/);
    expect(parts[0].data.length).toBe(clip.size);
    // EBML ヘッダ（webm / Matroska のマジックナンバー）。
    expect(parts[0].data.subarray(0, 4).toString("hex")).toBe("1a45dfa3");

    releaseUpload();
    await expect(uploadStatus(page)).toHaveText("Uploaded ✓");
    // <wcs-upload> は送り終えた files を null に戻して files-changed を出す。files は
    // wc-bindable の出力でもあるので clipFiles に書き戻り、ボタンは押せなくなる。
    await expect(uploadBtn(page)).toBeDisabled();

    // カメラ停止: active が false に戻り、トラックが止まり、プレビューが外れる。
    await stopCamBtn(page).click();
    await expect(camStatus(page)).toHaveText("Camera off.");
    await expect(startBtn(page)).toBeVisible();
    await expect(recordBtn(page)).toBeDisabled();
    expect(
      await page.evaluate(() =>
        (window as any).__stream.getTracks().map((t: MediaStreamTrack) => t.readyState),
      ),
    ).toEqual(["ended"]);
    expect(await camera(page).evaluate((el: any) => el.videoElement.srcObject)).toBeNull();
    // 録画済みのクリップはカメラを止めても残る（値として state にある）。
    await expect(playback).toBeVisible();
    await expect(uploadStatus(page)).toHaveText("Uploaded ✓");

    expect(errors).toEqual([]);
  });

  test("アップロードの失敗を表示し、撮り直したクリップは送れる", async ({ page }) => {
    const errors = collectErrors(page);
    let attempt = 0;
    const posts = await mockUpload(page, async (route) => {
      attempt++;
      if (attempt === 1) {
        await route.fulfill({ status: 500, headers: CORS, body: "server error" });
        return;
      }
      await okUpload(route, route.request());
    });
    await page.goto("/examples/state-camera-record-upload/");

    await startCamera(page);
    await recordClip(page);
    await expect(uploadStatus(page)).toHaveText("Ready to upload.");

    await uploadBtn(page).click();
    await expect(uploadStatus(page)).toHaveText("Upload failed.");
    // <wcs-upload> は失敗でも送った files を null に戻す（README: upload() の後に
    // files-changed）。clipFiles も null になるので、同じクリップは送り直せない。
    await expect(uploadBtn(page)).toBeDisabled();

    // 撮り直すと新しい File が clipFiles に入り、送れる。
    await recordClip(page);
    await expect(uploadBtn(page)).toBeEnabled();
    await uploadBtn(page).click();
    await expect(uploadStatus(page)).toHaveText("Uploaded ✓");
    expect(posts).toHaveLength(2);

    await stopCamBtn(page).click();
    await expect(camStatus(page)).toHaveText("Camera off.");

    // 500 応答はブラウザ自身が "Failed to load resource" を console.error に出す。
    // ページのコードの失敗ではないのでこの 1 件だけ除く。
    expect(
      errors.filter((e) => !/Failed to load resource: the server responded with a status of 500/.test(e)),
    ).toEqual([]);
  });

  test("撮り直すと新しいクリップに置き換わり、古い blob: URL は解放される", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/examples/state-camera-record-upload/");

    await startCamera(page);
    await recordClip(page);
    const playback = page.locator("video.playback");
    const firstUrl = await playback.getAttribute("src");
    expect(firstUrl).toMatch(/^blob:/);

    await recordClip(page);
    await expect(playback).not.toHaveAttribute("src", firstUrl!);
    await expect(playback).toHaveAttribute("src", /^blob:/);
    // <wcs-recorder> は次の録画の確定で前の object URL を revoke する。
    const firstStillReadable = await page.evaluate(async (url) => {
      try {
        await fetch(url);
        return true;
      } catch {
        return false;
      }
    }, firstUrl!);
    expect(firstStillReadable).toBe(false);

    await stopCamBtn(page).click();
    await expect(camStatus(page)).toHaveText("Camera off.");

    // revoke 済みの blob: URL への fetch はブラウザが "Failed to load resource" を出す。
    // 上の確認のために自分で起こしたものなので除く。
    expect(errors.filter((e) => !/Failed to load resource: net::ERR_FILE_NOT_FOUND/.test(e))).toEqual([]);
  });
});

test.describe("examples/state-camera-record-upload（タブの可視性）", () => {
  // Page Visibility はテストから切り替えられるよう document.visibilityState を差し替え、
  // visibilitychange を自分で dispatch する（headless ではタブを実際に隠せない）。
  test("録画していない間はタブが隠れるとカメラを止め、録画中は止めない（keepAlive: recording）", async ({ page }) => {
    // README の Key Points: `keepAlive: recording` は録画中だけカメラを生かし、それ以外は
    // 非表示で suspend・復帰で再取得する。@wcstack/state は wc-bindable の inputs の
    // `attribute` ヒント（{ name: "keepAlive", attribute: "keep-alive" }）に値を写す。
    // 4.0.0-rc.6 まで（3.x も）boolean を String(value) で写していたので、false が
    // keep-alive="false" になり、属性の有無で判定する <wcs-camera> は常に true と読んでいた。
    // 今は真偽属性として写す（false は属性を外す）。
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      let state: DocumentVisibilityState = "visible";
      Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => state });
      Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => state === "hidden" });
      (window as any).__setVisibility = (next: DocumentVisibilityState) => {
        state = next;
        document.dispatchEvent(new Event("visibilitychange"));
      };
    });
    const setVisibility = (v: "visible" | "hidden") =>
      page.evaluate((next) => (window as any).__setVisibility(next), v);
    await page.goto("/examples/state-camera-record-upload/");

    await startCamera(page);

    // 録画していない: 隠れるとストリームを手放し、戻ると取り直す。
    await setVisibility("hidden");
    await expect(camStatus(page)).toHaveText("Camera off.");
    expect(
      await page.evaluate(() =>
        (window as any).__stream.getTracks().map((t: MediaStreamTrack) => t.readyState),
      ),
    ).toEqual(["ended"]);
    await setVisibility("visible");
    await expect(camStatus(page)).toHaveText("Camera live.");

    // 録画中: 隠れてもカメラは生きたままで、録画も続く。
    await recordBtn(page).click();
    await expect(page.locator(".rec")).toBeVisible();
    await setVisibility("hidden");
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await expect(camStatus(page)).toHaveText("Camera live.");
    await expect(page.locator(".rec")).toBeVisible();
    await setVisibility("visible");
    await waitForRecordedFrames(page);
    await stopRecBtn(page).click();
    await expect(page.locator("video.playback")).toBeVisible();

    await stopCamBtn(page).click();
    await expect(camStatus(page)).toHaveText("Camera off.");

    expect(errors).toEqual([]);
  });
});

test.describe("examples/state-camera-record-upload（カメラ拒否）", () => {
  // 拒否は getUserMedia を NotAllowedError で reject させて作る
  // （--use-fake-ui-for-media-stream は実物のプロンプトを自動承認してしまうため）。
  // 許可を与えない headless Chromium は Permissions API で camera を最初から denied と
  // 答えるので、query も「まだ聞いていない」prompt を返す版に差し替え、
  // <wcs-permission> の値を <wcs-camera> が同じ camPerm パスで上書きする流れを見る。
  test.use({ permissions: [] });

  test("getUserMedia が拒否されるとバナー・denied ピル・エラー文言を出す", async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
      const realQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = ((desc: PermissionDescriptor) =>
        desc?.name === ("camera" as PermissionName)
          ? Promise.resolve(Object.assign(new EventTarget(), { name: "camera", state: "prompt", onchange: null }))
          : realQuery(desc)) as typeof navigator.permissions.query;
    });
    await page.goto("/examples/state-camera-record-upload/");

    const pill = page.locator(".pill");
    await expect(pill).toHaveText("prompt");
    await expect(pill).toHaveClass(/\bprompt\b/);
    await expect(page.locator(".banner")).toHaveCount(0);

    await startBtn(page).click();
    // <wcs-camera> が同じ camPerm パスを denied に書き換え、派生がそろって追従する。
    await expect(pill).toHaveText("denied");
    await expect(pill).toHaveClass(/\bdenied\b/);
    await expect(pill).not.toHaveClass(/\bprompt\b/);
    await expect(page.locator(".banner")).toHaveText("Camera is blocked — enable it in site settings.");
    await expect(camStatus(page)).toHaveText("Camera error: NotAllowedError");
    await expect(startBtn(page)).toBeVisible();
    await expect(recordBtn(page)).toBeDisabled();

    expect(errors).toEqual([]);
  });
});
