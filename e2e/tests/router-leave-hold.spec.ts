import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// <wcs-router> の leaveHold（docs/v4-direction-2026-10.md §5.28、継ぎ目アプリ street-reports の「留まる」）。
// 下書きのある間（leaveHold: dirty）、別のルートへのナビゲーション — リンク、戻る、navigateUrl — を止めて行き先を
// leaving に出し、ページ自身のダイアログが proceed() / stay() で答える。@browsers は Firefox でも走る
// （playwright.config.ts の firefox プロジェクト）: 戻るの navigate イベントを取り消せるか、はブラウザが決める。

const FIXTURE = "/e2e/fixtures/router-leave-hold.html";

async function editWithDraft(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await expect(page.locator("#view")).toHaveText("home");
  await page.getByRole("link", { name: "edit" }).click();
  await expect(page.locator("#view")).toHaveText("edit");
  await page.locator("#draft").fill("half a sentence");
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Unsaved changes" });

test.describe("router-leave-hold — ページが答える「留まる」", () => {
  test("@browsers リンク: 下書きのある間は止めて行き先を出し、「編集に戻る」で留まり、「破棄して移動」で行く", async ({ page }) => {
    const errors = collectErrors(page);
    await editWithDraft(page);

    await page.getByRole("link", { name: "other" }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator("#dest")).toHaveText("/other");
    await expect(page).toHaveURL(/\/e2e\/fixtures\/edit$/);
    await expect(page.locator("#view")).toHaveText("edit");

    await dialog(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/e2e\/fixtures\/edit$/);
    await expect(page.locator("#draft")).toHaveValue("half a sentence");

    await page.getByRole("link", { name: "other" }).click();
    await expect(page.locator("#dest")).toHaveText("/other");
    await dialog(page).getByRole("button", { name: "Discard and leave" }).click();
    await expect(page.locator("#view")).toHaveText("other");
    await expect(page).toHaveURL(/\/e2e\/fixtures\/other$/);
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("@browsers 戻る: 下書きのある間は止めてダイアログを出し、「破棄して移動」でその項目へ戻る", async ({ page }) => {
    const errors = collectErrors(page);
    await editWithDraft(page);

    // (a held Back never commits: goBack() would wait for it until its timeout)
    await page.goBack({ timeout: 1500 }).catch(() => {});
    await expect(dialog(page)).toBeVisible();
    // (the route's form: the router reads the fixture's own URL as "/". proceed() goes back to the entry by its key)
    await expect(page.locator("#dest")).toHaveText("/");
    await expect(page).toHaveURL(/\/e2e\/fixtures\/edit$/);
    await expect(page.locator("#view")).toHaveText("edit");

    await dialog(page).getByRole("button", { name: "Discard and leave" }).click();
    await expect(page.locator("#view")).toHaveText("home");
    await expect(page).toHaveURL(new RegExp(`${FIXTURE}$`));
    // it went back: Forward reaches the edit page again (the held Back did not add an entry)
    await page.goForward();
    await expect(page.locator("#view")).toHaveText("edit");
    expect(errors).toEqual([]);
  });

  test("止めている間の別のリンクは行き先を置き換える", async ({ page }) => {
    await editWithDraft(page);
    await page.getByRole("link", { name: "other" }).click();
    await expect(page.locator("#dest")).toHaveText("/other");
    await page.getByRole("link", { name: "home" }).click();
    await expect(page.locator("#dest")).toHaveText("/");
    await dialog(page).getByRole("button", { name: "Discard and leave" }).click();
    await expect(page.locator("#view")).toHaveText("home");
  });

  test("保存のハンドラが下書きを片付けて navigateUrl を書く: 同じ更新なので止めない。下書きの無いリンクも止めない", async ({ page }) => {
    const errors = collectErrors(page);
    await editWithDraft(page);
    await page.getByRole("button", { name: "Save and go" }).click();
    await expect(page.locator("#view")).toHaveText("other");
    await expect(dialog(page)).toHaveCount(0);

    await page.getByRole("link", { name: "edit" }).click();
    await expect(page.locator("#view")).toHaveText("edit");
    await page.getByRole("link", { name: "home" }).click();
    await expect(page.locator("#view")).toHaveText("home");
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
