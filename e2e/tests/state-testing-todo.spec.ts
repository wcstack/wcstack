import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// examples/state-testing-todo — @wcstack/state だけの ToDo ページ。デモの主題は
// 「同じページを @wcstack/testing でヘッドレスに（vitest + happy-dom）テストする」
// ことで、その suite は examples/state-testing-todo/__tests__ にある。この spec は
// 同じ index.html を実ブラウザで開き、ユーザーの操作で同じ機能を確かめる:
// フォームの送信での追加（onsubmit#prevent — 4.0 では submit はルートに委譲される）、
// 前後の空白の除去と空の入力の無視、checkbox の双方向バインドと行の class.done、
// $getAll を読む remaining、Clear done による絞り込み（新しい配列の代入で、残った
// 行が値と一緒に正しい位置に来ること）。happy-dom では見えない、CSS の取り消し線と
// 送信でページが遷移しないことも見る。

const URL_ = "/examples/state-testing-todo/";

const rows = (page: Page) => page.locator("#todos li");
const titles = (page: Page) => rows(page).locator("label span");
const checkbox = (page: Page, index: number) => rows(page).nth(index).locator('input[type="checkbox"]');
const draft = (page: Page) => page.locator("#draft");
const remaining = (page: Page) => page.locator("#remaining");

async function ready(page: Page): Promise<void> {
  await expect(titles(page)).toHaveText(["Write the tests first"]);
  await expect(remaining(page)).toHaveText("1");
}

/** 入力して Add ボタンで送信する */
async function addByButton(page: Page, text: string): Promise<void> {
  await draft(page).fill(text);
  await page.locator("#add").click();
}

test.describe("examples/state-testing-todo", () => {
  test("初期表示: 1 件の未完了の行と残数 1", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);

    await expect(rows(page)).toHaveCount(1);
    await expect(checkbox(page, 0)).not.toBeChecked();
    await expect(rows(page).nth(0)).not.toHaveClass(/\bdone\b/);
    await expect(draft(page)).toHaveValue("");
    // 4.0 は for: の行のために複製した要素から data-wcs を外す（migration-v4 §3.4）
    await expect(page.locator("#todos [data-wcs]")).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("フォームの送信（ボタンと Enter）で追加し、前後の空白を除いて入力欄を空に戻す。ページは遷移しない", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);
    // 同じドキュメントのままか（送信でページが読み直されていないか）を見分ける目印
    await page.evaluate(() => { (window as unknown as Record<string, string>).__marker = "same-document"; });

    await addByButton(page, "  Ship it  ");
    await expect(titles(page)).toHaveText(["Write the tests first", "Ship it"]);
    await expect(draft(page)).toHaveValue("");
    await expect(remaining(page)).toHaveText("2");

    await draft(page).fill("Review the diff");
    await draft(page).press("Enter");
    await expect(titles(page)).toHaveText(["Write the tests first", "Ship it", "Review the diff"]);
    await expect(draft(page)).toHaveValue("");
    await expect(remaining(page)).toHaveText("3");
    // 追加した行は未完了
    await expect(checkbox(page, 1)).not.toBeChecked();
    await expect(checkbox(page, 2)).not.toBeChecked();

    // #prevent が効いていて、GET 送信でクエリ付きの URL に飛んでいない
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(URL_);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__marker)).toBe("same-document");

    expect(errors).toEqual([]);
  });

  // デモのヘッドレス suite（__tests__/todo.test.ts）と同じ操作の形: @wcstack/testing の
  // fire() は input と submit を同じタスクの中で同期に起こす。要素の書き戻し（draft =
  // "Ship it"）と add() の書き込み（draft = ""）が同じ drain に入るので、drain の時点の
  // draft は描画済みの値（""）と同じになる。それでも入力欄は state の draft（""）を
  // 映していなければならない — 同じパスの {{ }} や textContent: は "" を出している。
  // 4.0.0-rc.6 の不具合の回帰: ここで入力欄に "Ship it" が残っていた（3.5.4 は空にする）。
  // Binding.apply は最後に当てた値と同じなら何もしないが、writeBack がその値を古いまま
  // 残していたため（packages/state の fixes.test.ts に最小の形）。
  test("input と submit が同じタスクで起きても（@wcstack/testing の fire() と同じ形）、追加後の入力欄は空になる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);

    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("#draft")!;
      input.value = "  Ship it  ";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("form")!.requestSubmit();
    });
    await expect(titles(page)).toHaveText(["Write the tests first", "Ship it"]);
    await expect(remaining(page)).toHaveText("2");
    await expect(draft(page)).toHaveValue("");

    expect(errors).toEqual([]);
  });

  test("空白だけの入力は追加しない", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);

    await addByButton(page, "   ");
    await draft(page).press("Enter");
    await addByButton(page, "");
    // 最後に有効な追加をして、そこまでの送信が処理済みであることを確かめる
    await addByButton(page, "real one");
    await expect(titles(page)).toHaveText(["Write the tests first", "real one"]);
    await expect(remaining(page)).toHaveText("2");

    expect(errors).toEqual([]);
  });

  test("checkbox の切り替え: 行の class.done（取り消し線）と残数が追従する", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);
    await addByButton(page, "second");
    await expect(remaining(page)).toHaveText("2");

    await checkbox(page, 0).check();
    await expect(rows(page).nth(0)).toHaveClass(/\bdone\b/);
    await expect(remaining(page)).toHaveText("1");
    // ページの CSS（li.done span）が実際に当たっている
    await expect(titles(page).nth(0)).toHaveCSS("text-decoration-line", "line-through");
    await expect(titles(page).nth(1)).toHaveCSS("text-decoration-line", "none");
    await expect(rows(page).nth(1)).not.toHaveClass(/\bdone\b/);

    await checkbox(page, 1).check();
    await expect(remaining(page)).toHaveText("0");

    await checkbox(page, 0).uncheck();
    await expect(rows(page).nth(0)).not.toHaveClass(/\bdone\b/);
    await expect(titles(page).nth(0)).toHaveCSS("text-decoration-line", "none");
    await expect(remaining(page)).toHaveText("1");

    expect(errors).toEqual([]);
  });

  test("Clear done は完了した行だけを外し、残った行はチェック状態ごと正しい位置に来て、その後も操作できる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);
    for (const title of ["B", "C", "D"]) await addByButton(page, title);
    await expect(titles(page)).toHaveText(["Write the tests first", "B", "C", "D"]);

    // 1 番目と 3 番目を完了にする。残る B と D はそれぞれ 1 つずつ前へ詰まる
    await checkbox(page, 0).check();
    await checkbox(page, 2).check();
    await expect(remaining(page)).toHaveText("2");

    await page.locator("#clear").click();
    await expect(titles(page)).toHaveText(["B", "D"]);
    await expect(checkbox(page, 0)).not.toBeChecked();
    await expect(checkbox(page, 1)).not.toBeChecked();
    await expect(page.locator("#todos li.done")).toHaveCount(0);
    await expect(remaining(page)).toHaveText("2");

    // 詰まった行の checkbox は、その行の値（D）に書き込む
    await checkbox(page, 1).check();
    await expect(rows(page).nth(1)).toHaveClass(/\bdone\b/);
    await expect(rows(page).nth(0)).not.toHaveClass(/\bdone\b/);
    await expect(remaining(page)).toHaveText("1");

    // 完了が無いときの Clear done は何も外さない
    await checkbox(page, 1).uncheck();
    await page.locator("#clear").click();
    await expect(titles(page)).toHaveText(["B", "D"]);

    // 全部完了にして消すと空になり、そこから追加できる
    await checkbox(page, 0).check();
    await checkbox(page, 1).check();
    await page.locator("#clear").click();
    await expect(rows(page)).toHaveCount(0);
    await expect(remaining(page)).toHaveText("0");
    await addByButton(page, "fresh start");
    await expect(titles(page)).toHaveText(["fresh start"]);
    await expect(checkbox(page, 0)).not.toBeChecked();
    await expect(remaining(page)).toHaveText("1");

    expect(errors).toEqual([]);
  });
});
