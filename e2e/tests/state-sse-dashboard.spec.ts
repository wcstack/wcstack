import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// state($streams) + sse + network: 同じ SSE フィードを <wcs-sse> タグと $streams
// (EventSource を標準 ReadableStream で包むブリッジ) の両イディオムで消費する
// ダッシュボード。$streams の実ブラウザ検証を兼ねる:
//  - ReadableStream ブリッジ経由でチャンクが fold されること
//  - ホスト切替 = 依存駆動 restart が fold を initial から数え直すこと
//  - 旧 run の abort が reader.cancel() → ReadableStream の cancel() →
//    EventSource.close() まで伝播し、サーバー側の接続が残らないこと
test.describe("examples/state-sse-dashboard", () => {
  test("両パネルにサンプルが流れ、ホスト切替で $streams 側が自動リセット・旧接続が閉じる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/examples/state-sse-dashboard/");

    const rightSamples = page
      .locator(".panel.right .stats span", { hasText: "samples" })
      .locator("b");
    const leftSamples = page
      .locator(".panel.left .stats span", { hasText: "samples" })
      .locator("b");

    // 右パネル($streams): ReadableStream ブリッジ経由でサンプルが fold される
    await expect(async () => {
      expect(Number(await rightSamples.textContent())).toBeGreaterThanOrEqual(3);
    }).toPass();

    // 左パネル(<wcs-sse>): 接続が確立しサンプルを受信する
    await expect(page.locator(".panel.left .chip")).toHaveText("connected");
    await expect(async () => {
      expect(Number(await leftSamples.textContent())).toBeGreaterThanOrEqual(1);
    }).toPass();

    // 開いている SSE 接続は 2 本 (左 <wcs-sse> + 右 $streams)
    await expect(async () => {
      const r = await page.request.get("/api/metrics-connections");
      expect((await r.json()).active).toBe(2);
    }).toPass();

    // ホスト B へ切替
    await page.getByRole("button", { name: /host B/ }).click();

    // $streams 側: args の依存駆動 restart で initial から数え直し (手動リセット不要)
    await expect(async () => {
      expect(Number(await rightSamples.textContent())).toBeLessThan(3);
    }).toPass();
    // そして新ホストのフィードで再び流れ始める
    await expect(async () => {
      expect(Number(await rightSamples.textContent())).toBeGreaterThanOrEqual(2);
    }).toPass();

    // 旧接続はどちらのイディオムでも閉じ、開いているのは切替後の 2 本だけ。
    // 右パネルは「runtime の abort → reader.cancel() → ReadableStream cancel()
    // → EventSource.close()」の伝播をサーバー側の事実で検証している。
    await expect(async () => {
      const r = await page.request.get("/api/metrics-connections");
      expect((await r.json()).active).toBe(2);
    }).toPass();

    expect(errors).toEqual([]);
  });
});
