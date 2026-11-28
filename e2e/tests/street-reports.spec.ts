// @ts-nocheck — the bodies are the author's JavaScript tests, kept as written
import { test as base, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// examples/street-reports — みどり市 道路・公園の不具合 受付台帳（継ぎ目アプリ、docs/seam-apps.md の street-reports）。
// 市の職員が市民からの通報（道路・街灯・公園・標識）を扱う画面: 絞り込みと検索と一括の割り当てのある一覧、通報の
// ページ（状態の変更・409・コメント・写真のライトボックス・次の通報）、下書きと離脱の確認のある新規登録、別の職員の
// 変更が SSE で届くボード、期間と並べ替えの統計、テーマと担当者の設定。React のチームが書いたアプリを、初めての作者が
// wcstack へ移したもの。
//
// この spec は、作者のブラウザのテスト（e2e/*.spec.js の list / detail / new-report / board / stats / global、50 件）を
// 意図として固定する。作者は React のアプリに対して書き、移した後のアプリでも書き換えずに通した（役割・ラベル・文字で
// 探す）。本文は作者が書いたまま（ファイルごとにブロックで囲んだだけ）。作者の走らせ方と違うところ:
// - サーバーは例の server.js（作者の server/server.js と APP_DIR を引き継いだもの。API とテスト用のフック
//   /api/_test/reset・fail・delay・clock・log は同じ）。CDN を使わない: WCS_LOCAL=1 でページの esm.run の行が
//   /packages/<pkg>/dist/auto.min.js になる。
// - 外したアサーションが 1 つ: 「every route survives a reload (SPA fallback)」は、返った文書に React のルート要素
//   `<div id="root">` があることを確かめていた。例のページにその包みは無いので、代わりにテストの目的 — 返ったのが
//   アプリのページであること（`<wcs-state` を含む）— を確かめる。
// - 作者は Chromium・Firefox・WebKit で全部を走らせた。ここでは Chromium で全部を走らせ、二つ目のエンジンで見る値打ちの
//   あるもの — 別のコンテキストからのボードの即時の移動、離脱の確認、ライトボックス、検索の debounce、イベントの
//   ストリームが漏れないこと、別のタブのテーマ — に @browsers を付けた（e2e/playwright.config.ts の firefox
//   プロジェクトがこのファイルを選ぶ）。WebKit はこのリポジトリの e2e では走らせない。
// - fixtures に足したものが 1 つ: ページの捕まえられなかったエラーに、2xx / 3xx で答えなかったリクエストを添える。
//   「Failed to fetch dynamically imported module …/state/app.js」は state のファイルの名前を言うだけで、落ちたのが
//   その import のどのファイルかを言わない（着地のときの繰り返しで 1 度、/lib/api.js が net::ERR_NO_BUFFER_SPACE —
//   繰り返しで機械のソケットが尽きかけたときの Windows のエラー — で落ちていた）。
// - 作者の config の use のうちテストが頼るもの（locale・timezoneId・viewport・colorScheme）は test.use で渡す。
// どのテストも POST /api/_test/reset から始まり、捕まえられなかったページのエラーで失敗する。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）でワーカーごとに 8900 + 10 × index のポートで立てる
// （4199–4900 / 5000–5540 / 5700– / 6100– / 7100– / 7300– / 7500– / 7700– / 7900– / 8100– / 8300– / 8500– / 8700– は他の spec）。
const PORT = 8900 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

// ---------------------------------------------------------------- 作者の fixtures（e2e/fixtures.js）

/** The server's fixed clock: 2026-11-20 09:00 in Japan. */
const SERVER_NOW = new Date('2026-11-20T09:00:00+09:00');
const TITLE_SUFFIX = 'みどり市 不具合受付';

// (the author's started server/server.js with APP_DIR; the example's server is examples/street-reports/server.js)
function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['examples/street-reports/server.js'], {
      cwd: REPO_ROOT,
      env: { ...process.env, WCS_LOCAL: '1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error(`server on ${port} did not start:\n${output}`)), 15_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('Demo server running')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server on ${port} exited with ${code}:\n${output}`));
    });
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    process.kill(child.pid); // by PID, never by process name
  });
}

/** Test-side client for the API and its test hooks. */
class Api {
  constructor(request) {
    this.request = request;
    this.created = 0;
  }

  async json(method, url, data) {
    const response = await this.request.fetch(url, { method, data });
    const text = await response.text();
    return { status: response.status(), body: text ? JSON.parse(text) : null };
  }

  async get(url) {
    const { status, body } = await this.json('GET', url);
    expect(status, `GET ${url}`).toBeLessThan(400);
    return body;
  }

  reset() { return this.json('POST', '/api/_test/reset'); }
  fail(rule) { return this.json('POST', '/api/_test/fail', rule); }
  delay(rule) { return this.json('POST', '/api/_test/delay', rule); }
  clock(now) { return this.json('POST', '/api/_test/clock', { now: now instanceof Date ? now.toISOString() : now }); }
  log() { return this.get('/api/_test/log'); }

  /** Logged API requests, optionally filtered by method and path. */
  async requests({ method, path: p } = {}) {
    const log = await this.log();
    return log.filter((e) => e.method && (!method || e.method === method) && (!p || e.path === p));
  }

  /** Event streams currently open according to the server log. */
  async openStreams() {
    const log = await this.log();
    return log.filter((e) => e.sse === 'open').length - log.filter((e) => e.sse === 'close').length;
  }

  createReport(overrides = {}) {
    return this.json('POST', '/api/reports', {
      title: 'テスト用の通報',
      category: 'road',
      subcategory: '段差',
      district: '中央',
      address: `みどり市中央9丁目${++this.created}`,
      description: 'テストのために登録した通報です。',
      priority: 2,
      anonymous: true,
      ...overrides,
    });
  }
}

const test = base.extend({
  // One server per worker, on 8900 + 10 × the worker's parallel index (the author's: PORT_BASE + the index).
  server: [
    async ({}, use) => {
      const child = await startServer(PORT);
      await use({ url: `http://127.0.0.1:${PORT}`, pid: child.pid });
      await stopServer(child);
    },
    { scope: 'worker', timeout: 30_000 },
  ],

  baseURL: async ({ server }, use) => {
    await use(server.url);
  },

  // Every test starts from the seed: auto fixture that resets the server first.
  api: [
    async ({ server, playwright }, use) => {
      const request = await playwright.request.newContext({
        baseURL: server.url,
        extraHTTPHeaders: { 'X-Test-No-Log': '1' }, // the suite's own calls stay out of the request log
      });
      const api = new Api(request);
      await api.reset();
      await use(api);
      await request.dispose();
    },
    { auto: true },
  ],

  // Uncaught page errors fail any test; console errors/warnings are collected for the main flows.
  consoleMessages: [
    async ({ page }, use) => {
      const messages = [];
      const pageErrors = [];
      page.on('console', (msg) => {
        if (msg.type() !== 'error' && msg.type() !== 'warning') return;
        // Firefox itself reports any open EventSource cut by a full page load (page.goto); not an app message.
        if (/The connection to \S+\/api\/events was interrupted while the page was loading/.test(msg.text())) return;
        messages.push(`${msg.type()}: ${msg.text()}`);
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      // (added on landing) the requests that did not answer 2xx / 3xx, named beside an uncaught error: "failed to
      // fetch dynamically imported module" names the state's file, not the file of its graph that failed
      const unanswered = [];
      page.on('requestfailed', (request) => unanswered.push(`${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
      page.on('response', (response) => {
        if (response.status() >= 400) unanswered.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
      });
      await use(messages);
      expect(pageErrors, `uncaught errors in the page (requests that failed: ${unanswered.join(', ') || 'none'})`).toEqual([]);
    },
    { auto: true },
  ],
});

// The author's playwright.config.js `use` values the tests rely on (dates and numbers in Japanese, the server's
// clock in Japan's time, the layout, the light theme as the starting point).
test.use({
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
  colorScheme: 'light',
  viewport: { width: 1280, height: 800 },
});

// ------------------------------------------------------------------ shared helpers

function reportTable(page) {
  return page.getByRole('table', { name: '通報' });
}

/** Body rows of the report list (every body row has a link to its report). */
function reportRows(page) {
  return reportTable(page).getByRole('row').filter({ has: page.getByRole('link') });
}

function reportRow(page, title) {
  return reportTable(page).getByRole('row').filter({ has: page.getByRole('link', { name: title, exact: true }) });
}

function rowTitles(page) {
  return reportTable(page).getByRole('link');
}

/** One close button per visible toast. */
function toastCloseButtons(page) {
  return page.getByRole('status').getByRole('button', { name: '通知を閉じる' });
}

function toast(page, text) {
  return page.getByRole('status').getByText(text);
}

/** Waits until the browser has painted twice (lets any pending React commit land). */
async function nextFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function query(params) {
  return new URLSearchParams(params).toString();
}

/**
 * Reloads like the user's reload button. Playwright's page.reload() in Firefox adds a new
 * history entry (and drops history.state), which would break Back-after-reload checks.
 */
async function reloadPage(page) {
  const loaded = page.waitForEvent('load');
  await page.evaluate(() => {
    setTimeout(() => window.location.reload(), 0);
  });
  await loaded;
}

// ---------------------------------------------------------------- 作者の list.spec.js
// (each file in its own block: two files declare the same STATUS / CATEGORY tables)
{
const titlesOf = (result) => result.items.map((r) => r.title);

test.describe('report list', () => {
  test('shows the first page: 20 rows, the total, newest first', async ({ page, api, consoleMessages }) => {
    const expected = await api.get('/api/reports?per=20');
    await page.goto('/reports');
    await expect(page.getByRole('heading', { level: 1, name: '通報一覧' })).toBeVisible();
    await expect(reportRows(page)).toHaveCount(20);
    await expect(rowTitles(page)).toHaveText(titlesOf(expected));
    await expect(page.getByText(`全 ${expected.total} 件`)).toBeVisible();
    await expect(page.getByText(`1 / ${Math.ceil(expected.total / 20)} ページ`)).toBeVisible();
    // Dates are YYYY/MM/DD and rows are newest first.
    const first = expected.items[0];
    const firstRow = reportRow(page, first.title);
    await expect(firstRow.getByRole('cell').nth(5)).toHaveText(/^\d{4}\/\d{2}\/\d{2}$/);
    expect(expected.items.map((r) => r.reportedAt)).toEqual([...expected.items.map((r) => r.reportedAt)].sort().reverse());
    expect(consoleMessages).toEqual([]);
  });

  test('status and category filters write the URL, survive a reload, and Back restores the previous filter', async ({ page, api }) => {
    const newOnly = await api.get(`/api/reports?${query({ status: 'new', per: 20 })}`);
    const newRoads = await api.get(`/api/reports?${query({ status: 'new', category: 'road', per: 20 })}`);
    expect(newRoads.total).toBeGreaterThan(0);
    expect(newRoads.total).toBeLessThan(newOnly.total);

    await page.goto('/reports');
    await expect(reportRows(page)).toHaveCount(20);
    await page.getByLabel('状態').selectOption({ label: '新規' });
    await expect(page).toHaveURL(/[?&]status=new/);
    await expect(rowTitles(page)).toHaveText(titlesOf(newOnly));

    await page.getByLabel('カテゴリ').selectOption({ label: '道路' });
    await expect(page).toHaveURL(/status=new/);
    await expect(page).toHaveURL(/category=road/);
    await expect(rowTitles(page)).toHaveText(titlesOf(newRoads));
    await expect(page.getByText(`全 ${newRoads.total} 件`)).toBeVisible();

    await reloadPage(page);
    await expect(page.getByLabel('状態')).toHaveValue('new');
    await expect(page.getByLabel('カテゴリ')).toHaveValue('road');
    await expect(rowTitles(page)).toHaveText(titlesOf(newRoads));

    await page.goBack();
    await expect(page).not.toHaveURL(/category=/);
    await expect(page).toHaveURL(/status=new/);
    await expect(page.getByLabel('カテゴリ')).toHaveValue('');
    await expect(rowTitles(page)).toHaveText(titlesOf(newOnly));
  });

  test('debounced search sends exactly one request for the final text, resets the page and adds no history entries @browsers', async ({ page, api }) => {
    const finalText = '北町2丁目';
    const expected = await api.get(`/api/reports?${query({ q: finalText, per: 20 })}`);
    expect(expected.total).toBeGreaterThan(0);

    // (added after landing) the page's clock stands still while the keys are typed, then moves past the debounce's
    // 300 ms. The test meant "keys typed faster than the debounce make one request", and took the 60 ms between keys
    // for granted — but the gaps are the test tool's: Playwright sends each character to the browser as its own
    // command, and in Firefox the first gap ranged 62–177 ms on this machine with the page idle (a setTimeout(0)
    // after each input ran within 3 ms). On a slower CI runner it passed 300 ms once, the debounce settled on 北, and
    // the searches were ["北", "北町2丁目"] (#774's run, the first failure kept as an artifact). With 400 ms between
    // keys the running clock gives ["北", "北町2", "北町2丁", "北町2丁目"] every time, in Chromium and Firefox; the
    // paused one gives one search.
    await page.clock.install();
    await page.goto('/reports?page=2');
    await expect(page.getByText(/^2 \/ \d+ ページ$/)).toBeVisible();
    const historyBefore = await page.evaluate(() => window.history.length);

    await page.clock.pauseAt(Date.now() + 1000);
    await page.getByPlaceholder('件名・住所で検索').pressSequentially(finalText, { delay: 60 });
    await page.clock.runFor(300);
    await page.clock.resume();
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(finalText)}`));
    await expect(page).not.toHaveURL(/page=/);
    await expect(rowTitles(page)).toHaveText(titlesOf(expected));

    const searches = (await api.requests({ method: 'GET', path: '/api/reports' })).filter((e) => 'q' in e.query);
    expect(searches.map((e) => e.query.q)).toEqual([finalText]);
    expect(await page.evaluate(() => window.history.length)).toBe(historyBefore);
  });

  test('a slow response for an earlier search never replaces the results of a later one', async ({ page, api }) => {
    const north = await api.get(`/api/reports?${query({ q: '北町', per: 20 })}`);
    const south = await api.get(`/api/reports?${query({ q: '南町', per: 20 })}`);
    await api.delay({ path: '/api/reports', method: 'GET', query: { q: '北町' }, ms: 1500, times: 1 });

    await page.goto('/reports');
    await expect(reportRows(page)).toHaveCount(20);
    const search = page.getByPlaceholder('件名・住所で検索');

    const slowRequest = page.waitForRequest((r) => r.url().includes(`q=${encodeURIComponent('北町')}`));
    await search.fill('北町');
    const slow = await slowRequest;
    // The slow request either gets aborted by the app or finishes later: wait for whichever happens.
    const slowSettled = Promise.race([
      page.waitForEvent('requestfailed', (r) => r === slow),
      page.waitForEvent('requestfinished', (r) => r === slow),
    ]);

    await search.fill('南町');
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent('南町')}`));
    await expect(rowTitles(page)).toHaveText(titlesOf(south));

    await slowSettled;
    await nextFrames(page);
    await expect(rowTitles(page)).toHaveText(titlesOf(south));
    await expect(page.getByRole('link', { name: north.items[0].title, exact: true })).toHaveCount(
      south.items.some((r) => r.title === north.items[0].title) ? 1 : 0,
    );
    await expect(search).toHaveValue('南町');
  });

  test('paging with 前へ / 次へ and the deep link ?status=new&page=2', async ({ page, api }) => {
    const page1 = await api.get(`/api/reports?${query({ status: 'new', per: 20, page: 1 })}`);
    const page2 = await api.get(`/api/reports?${query({ status: 'new', per: 20, page: 2 })}`);
    const pages = Math.ceil(page2.total / 20);
    expect(pages).toBe(2);

    await page.goto('/reports?status=new&page=2');
    await expect(page.getByLabel('状態')).toHaveValue('new');
    await expect(rowTitles(page)).toHaveText(titlesOf(page2));
    await expect(page.getByText(`2 / ${pages} ページ`)).toBeVisible();
    await expect(page.getByRole('button', { name: '次へ' })).toBeDisabled();

    await page.getByRole('button', { name: '前へ' }).click();
    await expect(page).not.toHaveURL(/page=/);
    await expect(rowTitles(page)).toHaveText(titlesOf(page1));
    await expect(page.getByText(`1 / ${pages} ページ`)).toBeVisible();
    await expect(page.getByRole('button', { name: '前へ' })).toBeDisabled();

    await page.getByRole('button', { name: '次へ' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(rowTitles(page)).toHaveText(titlesOf(page2));

    await page.goBack();
    await expect(rowTitles(page)).toHaveText(titlesOf(page1));
  });

  test('changing a filter resets the page to 1', async ({ page, api }) => {
    const parks = await api.get(`/api/reports?${query({ category: 'park', per: 20 })}`);
    await page.goto('/reports?page=3');
    await expect(page.getByText(/^3 \/ \d+ ページ$/)).toBeVisible();
    await page.getByLabel('カテゴリ').selectOption({ label: '公園' });
    await expect(page).toHaveURL(/category=park/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(rowTitles(page)).toHaveText(titlesOf(parks));
    await expect(page.getByText(`1 / ${Math.ceil(parks.total / 20)} ページ`)).toBeVisible();
  });

  test('shows the empty state and 条件をクリア restores the full list', async ({ page }) => {
    await page.goto(`/reports?q=${encodeURIComponent('存在しない場所')}&status=done`);
    await expect(page.getByText('該当する通報はありません')).toBeVisible();
    await expect(page.getByText('全 0 件')).toBeVisible();
    await expect(page.getByPlaceholder('件名・住所で検索')).toHaveValue('存在しない場所');

    await page.getByRole('button', { name: '条件をクリア' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(reportRows(page)).toHaveCount(20);
    await expect(page.getByText('該当する通報はありません')).toBeHidden();
    await expect(page.getByPlaceholder('件名・住所で検索')).toHaveValue('');
    await expect(page.getByLabel('状態')).toHaveValue('');
  });

  test('shows the error state and 再試行 loads the list', async ({ page, api }) => {
    await api.fail({ path: '/api/reports', method: 'GET', status: 500, times: 1 });
    await page.goto('/reports');
    await expect(page.getByText('読み込みに失敗しました')).toBeVisible();
    await expect(reportRows(page)).toHaveCount(0);
    await page.getByRole('button', { name: '再試行' }).click();
    await expect(reportRows(page)).toHaveCount(20);
    await expect(page.getByText('読み込みに失敗しました')).toBeHidden();
  });

  test('shows 読み込み中… while a slow response is pending', async ({ page, api }) => {
    await api.delay({ path: '/api/reports', method: 'GET', ms: 1500, times: 1 });
    await page.goto('/reports');
    await expect(page.getByText('読み込み中…')).toBeVisible();
    await expect(reportTable(page)).toHaveAttribute('aria-busy', 'true');
    await expect(reportRows(page)).toHaveCount(20);
    await expect(page.getByText('読み込み中…')).toBeHidden();
    await expect(reportTable(page)).toHaveAttribute('aria-busy', 'false');
  });

  test('row selection drives the header checkbox through unchecked, mixed and checked', async ({ page }) => {
    await page.goto('/reports');
    await expect(reportRows(page)).toHaveCount(20);
    const header = page.getByRole('checkbox', { name: 'このページの通報をすべて選択' });
    const rowBoxes = reportRows(page).getByRole('checkbox');

    await expect(header).toBeChecked({ checked: false });
    await expect(page.getByText(/件を選択中/)).toBeHidden();

    await rowBoxes.nth(0).check();
    await rowBoxes.nth(2).check();
    await expect(header).toBeChecked({ indeterminate: true });
    await expect(page.getByText('2 件を選択中')).toBeVisible();

    await header.click();
    await expect(header).toBeChecked();
    for (const box of await rowBoxes.all()) await expect(box).toBeChecked();
    await expect(page.getByText('20 件を選択中')).toBeVisible();

    await header.click();
    await expect(header).toBeChecked({ checked: false });
    await expect(page.getByText(/件を選択中/)).toBeHidden();

    // Selection is cleared when the filters change.
    await rowBoxes.nth(1).check();
    await expect(page.getByText('1 件を選択中')).toBeVisible();
    await page.getByLabel('状態').selectOption({ label: '新規' });
    await expect(page.getByText(/件を選択中/)).toBeHidden();
    await expect(header).toBeChecked({ checked: false });
  });

  test('bulk 自分に割り当て sends one request, shows the name and clears the selection', async ({ page, api }) => {
    const list = await api.get('/api/reports?per=20');
    const targets = list.items.filter((r) => r.assigneeId !== 3).slice(0, 3);

    await page.goto('/reports');
    await page.getByLabel('担当者').selectOption({ label: '高橋 美咲' });
    for (const r of targets) await reportRow(page, r.title).getByRole('checkbox').check();
    await expect(page.getByText('3 件を選択中')).toBeVisible();

    const response = page.waitForResponse((r) => r.url().endsWith('/api/reports/bulk'));
    await page.getByRole('button', { name: '自分に割り当て' }).click();
    for (const r of targets) await expect(reportRow(page, r.title).getByRole('cell').last()).toHaveText('高橋 美咲');
    expect((await response).status()).toBe(200);

    await expect(page.getByText(/件を選択中/)).toBeHidden();
    for (const r of targets) await expect(reportRow(page, r.title).getByRole('checkbox')).not.toBeChecked();
    await expect(toast(page, '3 件を更新しました')).toBeVisible();

    const bulk = await api.requests({ method: 'POST', path: '/api/reports/bulk' });
    expect(bulk).toHaveLength(1);
    expect(bulk[0].body.ids.sort()).toEqual(targets.map((r) => r.id).sort());
    expect(bulk[0].body.patch).toEqual({ assigneeId: 3 });

    await page.reload();
    for (const r of targets) await expect(reportRow(page, r.title).getByRole('cell').last()).toHaveText('高橋 美咲');
  });

  test('a failed bulk update rolls back and shows a toast', async ({ page, api }) => {
    const list = await api.get(`/api/reports?${query({ status: 'new', per: 20 })}`);
    const targets = list.items.slice(0, 2);
    await api.delay({ path: '/api/reports/bulk', method: 'POST', ms: 800, times: 1 });
    await api.fail({ path: '/api/reports/bulk', method: 'POST', status: 500, times: 1 });

    await page.goto('/reports?status=new');
    for (const r of targets) await reportRow(page, r.title).getByRole('checkbox').check();
    await page.getByRole('button', { name: '完了にする' }).click();

    // Optimistic first …
    for (const r of targets) await expect(reportRow(page, r.title).getByRole('cell').nth(2)).toHaveText('完了');
    // … then rolled back.
    await expect(toast(page, '更新に失敗しました')).toBeVisible();
    for (const r of targets) await expect(reportRow(page, r.title).getByRole('cell').nth(2)).toHaveText('新規');
    await expect(page.getByText('2 件を選択中')).toBeVisible();
    expect(await api.requests({ method: 'POST', path: '/api/reports/bulk' })).toHaveLength(1);
  });

  test('新着 markers: none on the first visit, new reports marked on return, cleared after the next visit', async ({ page, api }) => {
    const later = (minutes) => new Date(SERVER_NOW.getTime() + minutes * 60_000);
    await page.clock.setFixedTime(SERVER_NOW);
    await page.goto('/reports');
    await expect(reportRows(page)).toHaveCount(20);
    await expect(reportTable(page).getByText('新着')).toHaveCount(0);

    await page.getByRole('link', { name: 'ボード' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ボード' })).toBeVisible();

    // While away: someone registers a report.
    await api.clock(later(30));
    const created = await api.createReport({ title: '留守中に届いた通報' });
    expect(created.status).toBe(201);
    await page.clock.setFixedTime(later(60));

    await page.getByRole('link', { name: '通報一覧' }).click();
    await expect(rowTitles(page).first()).toHaveText('留守中に届いた通報');
    await expect(reportRow(page, '留守中に届いた通報').getByText('新着')).toBeVisible();
    await expect(reportTable(page).getByText('新着')).toHaveCount(1);

    await page.getByRole('link', { name: 'ボード' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ボード' })).toBeVisible();
    await page.getByRole('link', { name: '通報一覧' }).click();
    await expect(rowTitles(page).first()).toHaveText('留守中に届いた通報');
    await expect(reportTable(page).getByText('新着')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('street-reports:lastSeen'))).toBe(later(60).toISOString());
  });

  test('pressing / focuses the search field unless the user is typing', async ({ page }) => {
    await page.goto('/reports');
    await expect(reportRows(page)).toHaveCount(20);
    const search = page.getByPlaceholder('件名・住所で検索');
    await page.getByRole('heading', { level: 1 }).click();
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await page.keyboard.type('a/b');
    await expect(search).toHaveValue('a/b');
  });

  test('sets the document title', async ({ page }) => {
    await page.goto('/reports');
    await expect(page).toHaveTitle(`通報一覧 | ${TITLE_SUFFIX}`);
  });
});
}

// ---------------------------------------------------------------- 作者の detail.spec.js
// (each file in its own block: two files declare the same STATUS / CATEGORY tables)
{
const STATUS = { new: '新規', triaged: '確認済み', assigned: '対応中', done: '完了' };
const CATEGORY = { road: '道路', light: '街灯', park: '公園', sign: '標識', other: 'その他' };

test.describe('report detail', () => {
  test('a deep link shows every field and sets the document title', async ({ page, api, consoleMessages }) => {
    const report = await api.get('/api/reports/27');
    const staff = await api.get('/api/staff');
    await page.goto('/reports/27');

    await expect(page.getByRole('heading', { level: 1, name: report.title })).toBeVisible();
    await expect(page).toHaveTitle(`${report.title} - 通報 #27 | ${TITLE_SUFFIX}`);
    await expect(page.getByText('通報 #27', { exact: true })).toBeVisible();
    await expect(page.getByText(`${CATEGORY[report.category]}（${report.subcategory}）`)).toBeVisible();
    await expect(page.getByText(report.address, { exact: true })).toBeVisible();
    await expect(page.getByText(report.description)).toBeVisible();
    await expect(page.getByText(report.district, { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(report.reporterName))).toBeVisible();
    await expect(page.getByLabel('状態')).toHaveValue(report.status);
    await expect(page.getByLabel('担当', { exact: true })).toHaveValue(String(report.assigneeId ?? ''));
    await expect(page.getByLabel('優先度')).toHaveValue(String(report.priority));
    await expect(page.getByRole('button', { name: /^写真 \d を拡大$/ })).toHaveCount(report.photos.length);

    const comments = await api.get('/api/reports/27/comments');
    const list = page.getByRole('region', { name: 'コメント' }).getByRole('listitem');
    await expect(list).toHaveCount(comments.length);
    await expect(list.first()).toContainText(comments[0].body);
    await expect(list.first()).toContainText(staff.find((s) => s.id === comments[0].authorId).name);

    await expect(page.getByRole('link', { name: '前の通報' })).toHaveAttribute('href', '/reports/26');
    await expect(page.getByRole('link', { name: '次の通報' })).toHaveAttribute('href', '/reports/28');
    expect(consoleMessages).toEqual([]);
  });

  test('unknown and non-numeric ids show 通報が見つかりません', async ({ page, api }) => {
    await page.goto('/reports/99999');
    await expect(page.getByRole('heading', { name: '通報が見つかりません' })).toBeVisible();
    await page.getByRole('link', { name: '通報一覧へ戻る' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('heading', { level: 1, name: '通報一覧' })).toBeVisible();

    await page.goto('/reports/abc');
    await expect(page.getByRole('heading', { name: '通報が見つかりません' })).toBeVisible();
    await expect(page.getByRole('link', { name: '通報一覧へ戻る' })).toBeVisible();
    expect(await api.requests({ path: '/api/reports/abc' })).toHaveLength(0);
  });

  test('a status change sends one PATCH, survives a reload, and the header badge follows', async ({ page, api }) => {
    const summary = await api.get('/api/reports/summary');
    await page.goto('/reports/117');
    await expect(page.getByLabel('状態')).toHaveValue('new');
    await expect(page.getByText(`新規 ${summary.new} 件`)).toBeVisible();

    const patched = page.waitForResponse((r) => r.url().endsWith('/api/reports/117') && r.request().method() === 'PATCH');
    await page.getByLabel('状態').selectOption({ label: '確認済み' });
    await expect(page.getByText(`新規 ${summary.new - 1} 件`)).toBeVisible();
    expect((await patched).status()).toBe(200);

    const patches = await api.requests({ method: 'PATCH', path: '/api/reports/117' });
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ version: 1, status: 'triaged' });

    await page.reload();
    await expect(page.getByLabel('状態')).toHaveValue('triaged');
    await expect(page.getByText(`新規 ${summary.new - 1} 件`)).toBeVisible();
  });

  test('a 409 conflict shows 他の職員が更新しました and the server values', async ({ page, api }) => {
    await page.goto('/reports/117');
    await expect(page.getByLabel('状態')).toHaveValue('new');

    // Another staff member changes the report meanwhile.
    const other = await api.json('PATCH', '/api/reports/117', { version: 1, status: 'assigned', assigneeId: 2 });
    expect(other.status).toBe(200);

    await page.getByLabel('優先度').selectOption({ label: '高' });
    await expect(page.getByText(/他の職員が更新しました/)).toBeVisible();
    await expect(page.getByLabel('状態')).toHaveValue('assigned');
    await expect(page.getByLabel('担当', { exact: true })).toHaveValue('2');
    await expect(page.getByLabel('優先度')).toHaveValue(String(other.body.priority));
  });

  test('a failing PATCH rolls back and shows a toast', async ({ page, api }) => {
    const report = await api.get('/api/reports/117');
    const target = report.priority === 3 ? '1' : '3';
    await api.delay({ path: '/api/reports/117', method: 'PATCH', ms: 600, times: 1 });
    await api.fail({ path: '/api/reports/117', method: 'PATCH', status: 500, times: 1 });

    await page.goto('/reports/117');
    await expect(page.getByLabel('優先度')).toHaveValue(String(report.priority));
    await page.getByLabel('優先度').selectOption(target);
    await expect(page.getByLabel('優先度')).toHaveValue(target); // optimistic
    await expect(toast(page, '更新に失敗しました')).toBeVisible();
    await expect(page.getByLabel('優先度')).toHaveValue(String(report.priority));
  });

  test('quick 次の通報 clicks with a delayed first response end on the last report requested', async ({ page, api }) => {
    const last = await api.get('/api/reports/52');
    await api.delay({ path: '/api/reports/51', method: 'GET', ms: 1500, times: 1 });
    await page.goto('/reports/50');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText((await api.get('/api/reports/50')).title);

    const slowRequest = page.waitForRequest((r) => r.url().endsWith('/api/reports/51'));
    await page.getByRole('link', { name: '次の通報' }).click();
    await expect(page).toHaveURL(/\/reports\/51$/);
    const slow = await slowRequest;
    const slowSettled = Promise.race([
      page.waitForEvent('requestfailed', (r) => r === slow),
      page.waitForEvent('requestfinished', (r) => r === slow),
    ]);
    await page.getByRole('link', { name: '次の通報' }).click();
    await expect(page).toHaveURL(/\/reports\/52$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(last.title);

    await slowSettled;
    await nextFrames(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(last.title);
    await expect(page).toHaveTitle(`${last.title} - 通報 #52 | ${TITLE_SUFFIX}`);
  });

  test('adding a comment: counter, disabled states, Ctrl+Enter, textarea emptied and focused', async ({ page, api, consoleMessages }) => {
    await page.clock.setFixedTime(SERVER_NOW);
    const before = await api.get('/api/reports/27/comments');
    await page.goto('/reports/27');
    const comments = page.getByRole('region', { name: 'コメント' }).getByRole('listitem');
    await expect(comments).toHaveCount(before.length);

    const textarea = page.getByRole('textbox', { name: 'コメント' });
    const send = page.getByRole('button', { name: '送信' });
    await expect(page.getByText('0 / 500')).toBeVisible();
    await expect(send).toBeDisabled();

    await textarea.fill('   ');
    await expect(send).toBeDisabled();
    await textarea.fill('あ'.repeat(501));
    await expect(page.getByText('501 / 500')).toBeVisible();
    await expect(send).toBeDisabled();
    await textarea.fill('あ'.repeat(500));
    await expect(send).toBeEnabled();

    await textarea.fill('現地で確認しました');
    await expect(page.getByText('9 / 500')).toBeVisible();
    await send.click();
    await expect(comments).toHaveCount(before.length + 1);
    await expect(comments.last()).toContainText('現地で確認しました');
    await expect(comments.last()).toContainText('佐藤 花子');
    await expect(comments.last()).toContainText('たった今');
    await expect(textarea).toHaveValue('');
    await expect(textarea).toBeFocused();
    await expect(page.getByText('0 / 500')).toBeVisible();

    await textarea.fill('業者に連絡済み');
    await textarea.press('Control+Enter');
    await expect(comments).toHaveCount(before.length + 2);
    await expect(comments.last()).toContainText('業者に連絡済み');
    await expect(textarea).toHaveValue('');
    await expect(textarea).toBeFocused();

    const posts = await api.requests({ method: 'POST', path: '/api/reports/27/comments' });
    expect(posts.map((p) => p.body)).toEqual([
      { authorId: 1, body: '現地で確認しました' },
      { authorId: 1, body: '業者に連絡済み' },
    ]);
    expect(consoleMessages).toEqual([]);
  });

  test('a failing comment keeps the text and shows an error next to the form', async ({ page, api }) => {
    await api.fail({ path: '/api/reports/27/comments', method: 'POST', status: 500, times: 1 });
    await page.goto('/reports/27');
    const textarea = page.getByRole('textbox', { name: 'コメント' });
    await textarea.fill('送れないコメント');
    await page.getByRole('button', { name: '送信' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'コメントを送信できませんでした' })).toBeVisible();
    await expect(textarea).toHaveValue('送れないコメント');
    await expect(page.getByRole('region', { name: 'コメント' }).getByRole('listitem').filter({ hasText: '送れないコメント' })).toHaveCount(0);

    // Retrying succeeds and clears the error.
    await page.getByRole('button', { name: '送信' }).click();
    await expect(page.getByRole('region', { name: 'コメント' }).getByRole('listitem').last()).toContainText('送れないコメント');
    await expect(page.getByText('コメントを送信できませんでした')).toBeHidden();
  });

  test('the relative time of a comment keeps ticking', async ({ page }) => {
    await page.clock.install({ time: SERVER_NOW });
    await page.goto('/reports/27');
    await page.getByRole('textbox', { name: 'コメント' }).fill('時刻表示の確認');
    await page.getByRole('button', { name: '送信' }).click();
    const comment = page.getByRole('region', { name: 'コメント' }).getByRole('listitem').last();
    await expect(comment).toContainText('時刻表示の確認');
    await expect(comment).toContainText('たった今');

    await page.clock.fastForward('01:30');
    await expect(comment).toContainText('1 分前');
    await page.clock.fastForward('59:00');
    await expect(comment).toContainText('1 時間前');
    await page.clock.fastForward('24:00:00');
    await expect(comment).toContainText('2026/11/20');
  });

  test('the photo lightbox: opens from a thumbnail, traps focus, arrows, Escape, focus returns, page does not scroll @browsers', async ({ page, api }) => {
    const report = await api.get('/api/reports/18');
    expect(report.photos).toHaveLength(4);
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto('/reports/18');
    const thumb = page.getByRole('button', { name: '写真 2 を拡大' });
    await thumb.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 60));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(0);

    await thumb.click();
    const dialog = page.getByRole('dialog', { name: '写真 2 / 4' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('img')).toHaveAttribute('alt', report.photos[1].alt);
    await expect(dialog.getByRole('button', { name: '閉じる' })).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: '写真 3 / 4' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('dialog', { name: '写真 1 / 4' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('img')).toHaveAttribute('alt', report.photos[0].alt);

    // Focus is trapped inside the dialog in both directions.
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    }
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    }

    // The page behind does not scroll.
    await page.mouse.move(640, 240);
    await page.mouse.wheel(0, 400);
    await page.keyboard.press('PageDown');
    await nextFrames(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(thumb).toBeFocused();

    // 閉じる also closes and returns focus.
    await page.getByRole('button', { name: '写真 4 を拡大' }).click();
    await expect(page.getByRole('dialog', { name: '写真 4 / 4' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: '写真 4 を拡大' })).toBeFocused();
  });
});
}

// ---------------------------------------------------------------- 作者の new-report.spec.js
// (each file in its own block: two files declare the same STATUS / CATEGORY tables)
{
const DRAFT_KEY = 'street-reports:draft';

/** Fills a complete, valid form. */
async function fillValidForm(page, overrides = {}) {
  const v = {
    title: '公園のブランコの鎖が切れている',
    category: '公園',
    subcategory: '遊具の破損',
    district: '北町',
    address: 'みどり市北町9丁目1-1',
    description: 'ブランコの鎖が片方切れていて危険です。',
    reporterName: '山田 太郎',
    reporterPhone: '090-1234-5678',
    ...overrides,
  };
  await page.getByLabel('件名').fill(v.title);
  await page.getByLabel('カテゴリ').selectOption({ label: v.category });
  await page.getByLabel('種別').selectOption({ label: v.subcategory });
  await page.getByLabel('地区').selectOption({ label: v.district });
  await page.getByLabel('住所').fill(v.address);
  await page.getByLabel('詳細').fill(v.description);
  await page.getByRole('radio', { name: '高' }).check();
  if (v.reporterName !== null) await page.getByLabel('通報者名').fill(v.reporterName);
  if (v.reporterPhone !== null) await page.getByLabel('電話番号').fill(v.reporterPhone);
  return v;
}

test.describe('new report form', () => {
  test('validates on blur and on submit, focusing the first invalid field', async ({ page, api, consoleMessages }) => {
    await page.goto('/reports/new');
    await expect(page).toHaveTitle(`新規登録 | ${TITLE_SUFFIX}`);
    const title = page.getByLabel('件名');

    await title.focus();
    await expect(page.getByText('件名を入力してください')).toBeHidden();
    await page.keyboard.press('Tab');
    await expect(page.getByText('件名を入力してください')).toBeVisible();
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(title).toHaveAccessibleDescription('件名を入力してください');
    await expect(page.getByText('住所を入力してください')).toBeHidden(); // untouched fields stay quiet

    await title.fill('あ'.repeat(61));
    await expect(page.getByText('件名は60文字以内で入力してください')).toBeVisible();
    await title.fill('街灯が点かない');
    await expect(page.getByText(/件名(を入力|は60文字)/)).toBeHidden();
    await expect(title).not.toHaveAttribute('aria-invalid', 'true');

    await page.getByLabel('詳細').fill('短い');
    await expect(page.getByText('2 / 1000')).toBeVisible();

    await page.getByRole('button', { name: '登録' }).click();
    for (const message of ['カテゴリを選択してください', '種別を選択してください', '地区を選択してください', '住所を入力してください', '詳細は10文字以上で入力してください', '通報者名を入力してください']) {
      await expect(page.getByText(message)).toBeVisible();
    }
    await expect(page.getByLabel('カテゴリ')).toBeFocused();
    for (const label of ['カテゴリ', '地区', '住所', '詳細', '通報者名']) {
      await expect(page.getByLabel(label)).toHaveAttribute('aria-invalid', 'true');
    }
    expect(await api.requests({ method: 'POST', path: '/api/reports' })).toHaveLength(0);

    // Fixing earlier fields moves the focus target on the next attempt.
    await page.getByLabel('カテゴリ').selectOption({ label: '街灯' });
    await page.getByLabel('種別').selectOption({ label: '不点灯' });
    await page.getByLabel('地区').selectOption({ label: '中央' });
    await page.getByRole('button', { name: '登録' }).click();
    await expect(page.getByLabel('住所')).toBeFocused();
    expect(consoleMessages).toEqual([]);
  });

  test('the 種別 select resets and changes its options when カテゴリ changes', async ({ page }) => {
    await page.goto('/reports/new');
    const sub = page.getByLabel('種別');
    await expect(sub).toBeDisabled();
    await page.getByLabel('カテゴリ').selectOption({ label: '道路' });
    await sub.selectOption({ label: '陥没・穴' });
    await expect(sub).toHaveValue('陥没・穴');

    await page.getByLabel('カテゴリ').selectOption({ label: '街灯' });
    await expect(sub).toHaveValue('');
    await expect(sub.getByRole('option', { name: '不点灯' })).toHaveCount(1);
    await expect(sub.getByRole('option', { name: '陥没・穴' })).toHaveCount(0);
  });

  test('匿名の通報 hides the reporter fields and leaves them out of the request', async ({ page, api }) => {
    await page.goto('/reports/new');
    await fillValidForm(page);
    await page.getByLabel('匿名の通報').check();
    await expect(page.getByLabel('通報者名')).toBeHidden();
    await expect(page.getByLabel('電話番号')).toBeHidden();

    await page.getByRole('button', { name: '登録' }).click();
    await expect(page).toHaveURL(/\/reports\/\d+$/);
    const [post] = await api.requests({ method: 'POST', path: '/api/reports' });
    expect(post.body.anonymous).toBe(true);
    expect(post.body).not.toHaveProperty('reporterName');
    expect(post.body).not.toHaveProperty('reporterPhone');
    await expect(page.getByText('匿名', { exact: true })).toBeVisible();

    // Unchecking shows them again.
    await page.goto('/reports/new');
    await page.getByLabel('匿名の通報').check();
    await page.getByLabel('匿名の通報').uncheck();
    await expect(page.getByLabel('通報者名')).toBeVisible();
  });

  test('a successful submit: one POST even on a double click, navigation, toast, first in the list', async ({ page, api }) => {
    await api.delay({ path: '/api/reports', method: 'POST', ms: 700, times: 1 });
    await page.goto('/reports/new');
    const values = await fillValidForm(page);

    const submit = page.getByRole('button', { name: '登録' });
    await submit.dblclick();
    await expect(page.getByRole('button', { name: '送信中…' })).toBeDisabled();

    await expect(page).toHaveURL(/\/reports\/121$/);
    await expect(page.getByRole('heading', { level: 1, name: values.title })).toBeVisible();
    await expect(toast(page, '通報を登録しました')).toBeVisible();
    await expect(page.getByLabel('優先度')).toHaveValue('3');
    expect(await api.requests({ method: 'POST', path: '/api/reports' })).toHaveLength(1);

    await page.getByRole('link', { name: '通報一覧' }).click();
    await expect(rowTitles(page).first()).toHaveText(values.title);
  });

  test('a server 422 message is shown at its field', async ({ page, api }) => {
    const open = await api.get('/api/reports?status=triaged&per=1');
    await page.goto('/reports/new');
    await fillValidForm(page, { address: open.items[0].address });
    await page.getByRole('button', { name: '登録' }).click();

    const address = page.getByLabel('住所');
    await expect(page.getByText('同じ住所で対応中の通報がすでにあります')).toBeVisible();
    await expect(address).toHaveAttribute('aria-invalid', 'true');
    await expect(address).toBeFocused();
    await expect(page).toHaveURL(/\/reports\/new$/);

    await address.fill('みどり市北町9丁目2-2');
    await expect(page.getByText('同じ住所で対応中の通報がすでにあります')).toBeHidden();
  });

  test('the draft is restored after a reload, 破棄 clears it, and a successful submit removes it', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept()); // beforeunload while the form is dirty
    await page.goto('/reports/new');
    await page.getByLabel('件名').fill('下書きの件名');
    await page.getByLabel('カテゴリ').selectOption({ label: '標識' });
    await page.getByLabel('住所').fill('みどり市南町1丁目');
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)).toContain('みどり市南町1丁目');

    await page.reload();
    await expect(page.getByText('下書きを復元しました')).toBeVisible();
    await expect(page.getByLabel('件名')).toHaveValue('下書きの件名');
    await expect(page.getByLabel('カテゴリ')).toHaveValue('sign');
    await expect(page.getByLabel('住所')).toHaveValue('みどり市南町1丁目');

    await page.getByRole('button', { name: '破棄' }).click();
    await expect(page.getByText('下書きを復元しました')).toBeHidden();
    await expect(page.getByLabel('件名')).toHaveValue('');
    await expect(page.getByLabel('住所')).toHaveValue('');
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)).toBeNull();

    await page.reload();
    await expect(page.getByLabel('件名')).toHaveValue('');
    await expect(page.getByText('下書きを復元しました')).toBeHidden();

    await fillValidForm(page);
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)).not.toBeNull();
    await page.getByRole('button', { name: '登録' }).click();
    await expect(page).toHaveURL(/\/reports\/\d+$/);
    await expect(toast(page, '通報を登録しました')).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), DRAFT_KEY)).toBeNull();
    await page.getByRole('link', { name: '新規登録' }).click();
    await expect(page.getByLabel('件名')).toHaveValue('');
    await expect(page.getByText('下書きを復元しました')).toBeHidden();
  });

  test('the leave guard asks on a nav link and on Back; 編集に戻る keeps values, 破棄して移動 leaves, a clean form leaves freely @browsers', async ({ page }) => {
    await page.goto('/reports');
    await page.getByRole('link', { name: '新規登録' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '新規登録' })).toBeVisible();

    await page.getByLabel('件名').fill('離脱確認');
    await page.getByLabel('カテゴリ').selectOption({ label: '道路' });
    await page.getByLabel('種別').selectOption({ label: '段差' });
    await page.getByRole('radio', { name: '低' }).check();

    // A nav link asks.
    await page.getByRole('link', { name: 'ボード' }).click();
    const dialog = page.getByRole('dialog', { name: '入力内容を破棄しますか？' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '編集に戻る' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/reports\/new$/);
    await expect(page.getByLabel('件名')).toHaveValue('離脱確認');
    await expect(page.getByLabel('カテゴリ')).toHaveValue('road');
    await expect(page.getByLabel('種別')).toHaveValue('段差');
    await expect(page.getByRole('radio', { name: '低' })).toBeChecked();

    // Back asks too.
    await page.evaluate(() => window.history.back());
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '編集に戻る' }).click();
    await expect(page).toHaveURL(/\/reports\/new$/);
    await expect(page.getByLabel('件名')).toHaveValue('離脱確認');

    await page.evaluate(() => window.history.back());
    await dialog.getByRole('button', { name: '破棄して移動' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByRole('heading', { level: 1, name: '通報一覧' })).toBeVisible();

    // A clean form does not ask.
    await page.getByRole('link', { name: '新規登録' }).click();
    await expect(page.getByLabel('件名')).toHaveValue('');
    await page.getByRole('link', { name: 'ボード' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'ボード' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
}

// ---------------------------------------------------------------- 作者の board.spec.js
// (each file in its own block: two files declare the same STATUS / CATEGORY tables)
{
const COLUMNS = [
  { status: 'new', label: '新規' },
  { status: 'triaged', label: '確認済み' },
  { status: 'assigned', label: '対応中' },
  { status: 'done', label: '完了' },
];

const column = (page, label) => page.getByRole('region', { name: label, exact: true });
const card = (scope, title) => scope.getByRole('article', { name: title, exact: true });
const cardTitles = (scope) => scope.getByRole('article').getByRole('heading', { level: 3 });

function expectedOrder(cards, status) {
  return cards
    .filter((c) => c.status === status)
    .sort((a, b) => b.priority - a.priority || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
    .map((c) => c.title);
}

async function waitForBoard(page) {
  await expect(page.getByRole('heading', { level: 1, name: 'ボード' })).toBeVisible();
  await expect(column(page, '新規').getByRole('article').first()).toBeVisible();
}

test.describe('board', () => {
  test('shows four columns with counts and cards ordered by priority, then latest update', async ({ page, api, consoleMessages }) => {
    const cards = await api.get('/api/reports/board');
    await page.goto('/board');
    await waitForBoard(page);
    for (const { status, label } of COLUMNS) {
      const titles = expectedOrder(cards, status);
      await expect(column(page, label).getByText(`${titles.length} 件`, { exact: true })).toBeVisible();
      await expect(cardTitles(column(page, label))).toHaveText(titles);
    }
    const first = cards.find((c) => c.title === expectedOrder(cards, 'assigned')[0]);
    const firstCard = card(column(page, '対応中'), first.title);
    await expect(firstCard.getByRole('link', { name: first.title })).toHaveAttribute('href', `/reports/${first.id}`);
    await expect(firstCard).toContainText(first.district);
    await expect(firstCard).toContainText(/担当: \S+/);
    expect(consoleMessages).toEqual([]);
  });

  test('moving a card is optimistic, sends one PATCH, updates the counts, and the focus follows the card', async ({ page, api }) => {
    const cards = await api.get('/api/reports/board');
    const title = expectedOrder(cards, 'new')[0];
    const target = cards.find((c) => c.title === title);
    const newCount = cards.filter((c) => c.status === 'new').length;
    const triagedCount = cards.filter((c) => c.status === 'triaged').length;
    await api.delay({ path: `/api/reports/${target.id}`, method: 'PATCH', ms: 800, times: 1 });

    await page.goto('/board');
    await waitForBoard(page);
    const response = page.waitForResponse((r) => r.url().endsWith(`/api/reports/${target.id}`) && r.request().method() === 'PATCH');
    await card(column(page, '新規'), title).getByRole('button', { name: '進める →' }).click();

    // Before the server answers, the card has already moved.
    const moved = card(column(page, '確認済み'), title);
    await expect(moved).toBeVisible();
    await expect(card(column(page, '新規'), title)).toHaveCount(0);
    await expect(column(page, '新規').getByText(`${newCount - 1} 件`, { exact: true })).toBeVisible();
    await expect(column(page, '確認済み').getByText(`${triagedCount + 1} 件`, { exact: true })).toBeVisible();
    await expect(moved.getByRole('button', { name: '進める →' })).toBeFocused();

    expect((await response).status()).toBe(200);
    await expect(moved.getByRole('button', { name: '進める →' })).toBeFocused();
    const patches = await api.requests({ method: 'PATCH', path: `/api/reports/${target.id}` });
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ version: target.version, status: 'triaged' });

    // And back again with ← 戻す; the focus stays on that button.
    await moved.getByRole('button', { name: '← 戻す' }).click();
    await expect(card(column(page, '新規'), title).getByRole('button', { name: '← 戻す' })).toBeDisabled();
    await expect(card(column(page, '新規'), title).getByRole('button', { name: '進める →' })).toBeFocused();
  });

  test('a failing move rolls back with a toast', async ({ page, api }) => {
    const cards = await api.get('/api/reports/board');
    const title = expectedOrder(cards, 'triaged')[0];
    const target = cards.find((c) => c.title === title);
    const triagedCount = cards.filter((c) => c.status === 'triaged').length;
    await api.delay({ path: `/api/reports/${target.id}`, method: 'PATCH', ms: 600, times: 1 });
    await api.fail({ path: `/api/reports/${target.id}`, method: 'PATCH', status: 500, times: 1 });

    await page.goto('/board');
    await waitForBoard(page);
    await card(column(page, '確認済み'), title).getByRole('button', { name: '進める →' }).click();
    await expect(card(column(page, '対応中'), title)).toBeVisible();
    await expect(toast(page, '更新に失敗しました')).toBeVisible();
    await expect(card(column(page, '確認済み'), title)).toBeVisible();
    await expect(card(column(page, '対応中'), title)).toHaveCount(0);
    await expect(column(page, '確認済み').getByText(`${triagedCount} 件`, { exact: true })).toBeVisible();
  });

  test('a change made in another browser context moves the card within 2 s and updates the header badge @browsers', async ({ page, api, browser, baseURL }) => {
    const cards = await api.get('/api/reports/board');
    const summary = await api.get('/api/reports/summary');
    const title = expectedOrder(cards, 'new')[1];
    const target = cards.find((c) => c.title === title);

    await page.goto('/board');
    await waitForBoard(page);
    await expect(page.getByText(`新規 ${summary.new} 件`)).toBeVisible();
    await expect.poll(() => api.openStreams()).toBe(2); // header + board

    const otherContext = await browser.newContext({ baseURL });
    const other = await otherContext.newPage();
    await other.goto(`/reports/${target.id}`);
    await other.getByLabel('状態').selectOption({ label: '対応中' });
    await expect(other.getByText(`新規 ${summary.new - 1} 件`)).toBeVisible();

    await expect(card(column(page, '対応中'), title)).toBeVisible({ timeout: 2000 });
    await expect(card(column(page, '新規'), title)).toHaveCount(0);
    await expect(page.getByText(`新規 ${summary.new - 1} 件`)).toBeVisible({ timeout: 2000 });
    await otherContext.close();
  });

  test('自分の担当のみ shows only the current staff member’s cards and follows the 担当者 select', async ({ page, api }) => {
    const cards = await api.get('/api/reports/board');
    const staff = await api.get('/api/staff');
    await page.goto('/board');
    await waitForBoard(page);

    await page.getByLabel('自分の担当のみ').check();
    for (const member of [staff[0], staff[1]]) {
      await page.getByLabel('担当者').selectOption({ label: member.name });
      const mine = cards.filter((c) => c.assigneeId === member.id);
      expect(mine.length).toBeGreaterThan(0);
      await expect(page.getByRole('article')).toHaveCount(mine.length);
      for (const { status, label } of COLUMNS) {
        await expect(column(page, label).getByText(`${mine.filter((c) => c.status === status).length} 件`, { exact: true })).toBeVisible();
      }
      for (const article of await page.getByRole('article').all()) await expect(article).toContainText(`担当: ${member.name}`);
    }

    await page.getByLabel('自分の担当のみ').uncheck();
    await expect(page.getByRole('article')).toHaveCount(cards.length);
  });

  test('leaving and returning three times leaks no event streams @browsers', async ({ page, api }) => {
    await page.goto('/board');
    await waitForBoard(page);
    await expect.poll(() => api.openStreams()).toBe(2);
    const afterFirstVisit = await api.openStreams();

    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('link', { name: '通報一覧' }).click();
      await expect(page.getByRole('heading', { level: 1, name: '通報一覧' })).toBeVisible();
      await expect.poll(() => api.openStreams()).toBe(1); // only the header's stream stays
      await page.getByRole('link', { name: 'ボード' }).click();
      await waitForBoard(page);
      await expect.poll(() => api.openStreams()).toBe(afterFirstVisit);
    }
    const log = await api.log();
    expect(log.filter((e) => e.sse === 'open')).toHaveLength(5);
    expect(log.filter((e) => e.sse === 'close')).toHaveLength(3);
  });
});
}

// ---------------------------------------------------------------- 作者の stats.spec.js
// (each file in its own block: two files declare the same STATUS / CATEGORY tables)
{
const STATUS = { new: '新規', triaged: '確認済み', assigned: '対応中', done: '完了' };
const CATEGORY = { road: '道路', light: '街灯', park: '公園', sign: '標識', other: 'その他' };
const DAY = 24 * 3600 * 1000;

/** What the page should show, computed independently from the export API. */
function expectedNumbers(items) {
  const byStatus = Object.fromEntries(Object.keys(STATUS).map((s) => [s, items.filter((r) => r.status === s).length]));
  const byCategory = Object.fromEntries(Object.keys(CATEGORY).map((c) => [c, items.filter((r) => r.category === c).length]));
  const done = items.filter((r) => r.status === 'done');
  const avg = done.length
    ? `${(done.reduce((sum, r) => sum + (Date.parse(r.closedAt) - Date.parse(r.reportedAt)) / DAY, 0) / done.length).toFixed(1)} 日`
    : '—';
  return { total: items.length, byStatus, byCategory, avg };
}

async function expectNumbers(page, items) {
  const n = expectedNumbers(items);
  const totals = page.getByRole('list', { name: '状態別件数' }).getByRole('listitem');
  await expect(totals.filter({ hasText: '合計' })).toHaveText(new RegExp(`合計\\s*${n.total} 件`));
  for (const [status, label] of Object.entries(STATUS)) {
    await expect(totals.filter({ hasText: label })).toHaveText(new RegExp(`${label}\\s*${n.byStatus[status]} 件`));
  }
  await expect(totals.filter({ hasText: '平均対応日数' })).toHaveText(new RegExp(`平均対応日数\\s*${n.avg.replace('.', '\\.')}`));
  const bars = page.getByRole('list', { name: 'カテゴリ別件数' }).getByRole('listitem');
  for (const [category, label] of Object.entries(CATEGORY)) {
    await expect(bars.filter({ hasText: label })).toHaveText(new RegExp(`${label}\\s*${n.byCategory[category]} 件`));
  }
  const matrix = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'カテゴリ' }) });
  for (const [category, label] of Object.entries(CATEGORY)) {
    const row = matrix.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });
    const counts = Object.keys(STATUS).map((s) => String(items.filter((r) => r.category === category && r.status === s).length));
    await expect(row.getByRole('cell')).toHaveText([...counts, String(n.byCategory[category])]);
  }
}

test.describe('statistics', () => {
  test('presets write the range to the URL and the numbers match the export', async ({ page, api, consoleMessages }) => {
    await page.clock.setFixedTime(SERVER_NOW);
    await page.goto('/stats');
    await expect(page.getByRole('heading', { level: 1, name: '統計' })).toBeVisible();
    await expect(page.getByRole('button', { name: '30日' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('開始日')).toHaveValue('2026-10-22');
    await expect(page.getByLabel('終了日')).toHaveValue('2026-11-20');

    await page.getByRole('button', { name: '7日' }).click();
    await expect(page).toHaveURL(/from=2026-11-14/);
    await expect(page).toHaveURL(/to=2026-11-20/);
    await expect(page.getByRole('button', { name: '7日' })).toHaveAttribute('aria-pressed', 'true');
    await expectNumbers(page, await api.get(`/api/reports/export?${query({ from: '2026-11-14', to: '2026-11-20' })}`));
    await expect(page.getByRole('img', { name: /日別の通報数: 7 日間/ })).toBeVisible();

    await page.getByRole('button', { name: '90日' }).click();
    await expect(page).toHaveURL(/from=2026-08-23/);
    await expectNumbers(page, await api.get(`/api/reports/export?${query({ from: '2026-08-23', to: '2026-11-20' })}`));

    await page.reload();
    await expect(page.getByLabel('開始日')).toHaveValue('2026-08-23');
    await expectNumbers(page, await api.get(`/api/reports/export?${query({ from: '2026-08-23', to: '2026-11-20' })}`));
    expect(consoleMessages).toEqual([]);
  });

  test('an inverted range shows a message and sends no request', async ({ page, api }) => {
    await page.goto('/stats?from=2026-11-10&to=2026-11-01');
    await expect(page.getByText('開始日は終了日以前の日付を指定してください')).toBeVisible();
    await expect(page.getByLabel('開始日')).toHaveAttribute('aria-invalid', 'true');
    expect(await api.requests({ path: '/api/reports/export' })).toHaveLength(0);

    await page.getByLabel('開始日').fill('2026-10-25');
    await expect(page.getByText('開始日は終了日以前の日付を指定してください')).toBeHidden();
    await expect(page.getByRole('list', { name: '状態別件数' })).toBeVisible();
    await expect.poll(async () => (await api.requests({ path: '/api/reports/export' })).length).toBe(1);

    await page.getByLabel('終了日').fill('2026-10-01');
    await expect(page.getByText('開始日は終了日以前の日付を指定してください')).toBeVisible();
    await expect(page.getByRole('list', { name: '状態別件数' })).toBeHidden();
    expect(await api.requests({ path: '/api/reports/export' })).toHaveLength(1);
  });

  test('clicking a column header sorts the table and toggles aria-sort', async ({ page, api }) => {
    const items = await api.get(`/api/reports/export?${query({ from: '2026-08-23', to: '2026-11-20' })}`);
    await page.goto('/stats?from=2026-08-23&to=2026-11-20');
    const header = page.getByRole('columnheader', { name: '完了' });
    const matrix = page.getByRole('table').filter({ has: header });
    const rowHeaders = matrix.getByRole('rowheader');
    await expect(rowHeaders).toHaveText(Object.values(CATEGORY));
    await expect(header).not.toHaveAttribute('aria-sort', /ascending|descending/);

    const doneCount = (c) => items.filter((r) => r.category === c && r.status === 'done').length;
    const keys = Object.keys(CATEGORY);
    const ascending = keys.map((c, i) => ({ c, i })).sort((a, b) => doneCount(a.c) - doneCount(b.c) || a.i - b.i).map(({ c }) => CATEGORY[c]);
    const descending = keys.map((c, i) => ({ c, i })).sort((a, b) => doneCount(b.c) - doneCount(a.c) || a.i - b.i).map(({ c }) => CATEGORY[c]);

    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await expect(rowHeaders).toHaveText(ascending);
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(rowHeaders).toHaveText(descending);

    const total = page.getByRole('columnheader', { name: '合計' });
    await total.getByRole('button').click();
    await expect(total).toHaveAttribute('aria-sort', 'ascending');
    await expect(header).not.toHaveAttribute('aria-sort', /ascending|descending/);
  });

  test('/stats?boom=1 shows the error fallback and 再読み込み recovers once the URL no longer has boom', async ({ page }) => {
    await page.goto('/stats?boom=1');
    await expect(page.getByRole('heading', { name: '問題が発生しました' })).toBeVisible();
    // The shell stays usable.
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeVisible();

    await page.getByRole('button', { name: '再読み込み' }).click();
    await expect(page.getByRole('heading', { name: '問題が発生しました' })).toBeVisible(); // still boom

    await page.getByRole('link', { name: '統計' }).click();
    await expect(page).toHaveURL(/\/stats$/);
    await expect(page.getByRole('heading', { name: '問題が発生しました' })).toBeVisible();
    await page.getByRole('button', { name: '再読み込み' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '統計' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '問題が発生しました' })).toBeHidden();
  });
});
}

// ---------------------------------------------------------------- 作者の global.spec.js
// (each file in its own block: two files declare the same STATUS / CATEGORY tables)
{
const NAV = ['通報一覧', '新規登録', 'ボード', '統計'];

test.describe('app shell', () => {
  test('the theme toggle sets data-theme, persists over a reload, and a second tab follows @browsers', async ({ page, context }) => {
    await page.goto('/reports');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    const other = await context.newPage();
    await other.goto('/board');
    await expect(other.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'テーマ: ライト' }).click();
    await expect(page.getByRole('button', { name: 'テーマ: ダーク' })).toBeVisible();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(other.getByRole('button', { name: 'テーマ: ダーク' })).toBeVisible();

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'テーマ: ダーク' })).toBeVisible();

    await other.getByRole('button', { name: 'テーマ: ダーク' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await other.close();
  });

  test('the 担当者 choice defaults to the first staff member and persists over a reload', async ({ page, api }) => {
    const staff = await api.get('/api/staff');
    await page.goto('/reports');
    const select = page.getByLabel('担当者');
    await expect(select).toHaveValue(String(staff[0].id));
    await select.selectOption({ label: staff[2].name });
    await page.reload();
    await expect(page.getByLabel('担当者')).toHaveValue(String(staff[2].id));
    await page.goto('/board');
    await expect(page.getByLabel('担当者')).toHaveValue(String(staff[2].id));
  });

  test('the nav marks the active link with aria-current="page"', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'メインメニュー' });
    const cases = [
      ['/reports', '通報一覧'],
      ['/reports/new', '新規登録'],
      ['/reports/12', '通報一覧'],
      ['/board', 'ボード'],
      ['/stats', '統計'],
    ];
    for (const [path, active] of cases) {
      await page.goto(path);
      for (const name of NAV) {
        const link = nav.getByRole('link', { name, exact: true });
        if (name === active) await expect(link, `${path}: ${name}`).toHaveAttribute('aria-current', 'page');
        else await expect(link, `${path}: ${name}`).not.toHaveAttribute('aria-current', 'page');
      }
    }
    // Client-side navigation updates it too.
    await nav.getByRole('link', { name: 'ボード' }).click();
    await expect(nav.getByRole('link', { name: 'ボード' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: '統計' })).not.toHaveAttribute('aria-current', 'page');
  });

  test('/ redirects to /reports and unknown paths show the not-found page with a link home', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/reports$/);
    await page.goto('/no/such/page');
    await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
    await expect(page).toHaveTitle(`ページが見つかりません | ${TITLE_SUFFIX}`);
    await page.getByRole('link', { name: 'トップへ戻る' }).click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(reportRows(page)).toHaveCount(20);
  });

  test('toasts disappear after 4 seconds or via ×, and at most 3 are shown at once', async ({ page, api }) => {
    await page.clock.install({ time: SERVER_NOW });
    const report = await api.get('/api/reports/117');
    await api.fail({ path: '/api/reports/117', method: 'PATCH', status: 500, times: 4 });
    await page.goto('/reports/117');
    const priority = page.getByLabel('優先度');
    await expect(priority).toHaveValue(String(report.priority));
    await page.clock.pauseAt(new Date(SERVER_NOW.getTime() + 60_000));

    const target = report.priority === 3 ? '1' : '3';
    for (let i = 1; i <= 4; i += 1) {
      const response = page.waitForResponse((r) => r.request().method() === 'PATCH');
      await priority.selectOption(target);
      await response;
      await expect(priority).toHaveValue(String(report.priority)); // rolled back
      await expect(toastCloseButtons(page)).toHaveCount(Math.min(i, 3));
    }
    await expect(toast(page, '更新に失敗しました')).toHaveCount(3);

    await page.clock.runFor(3900);
    await expect(toastCloseButtons(page)).toHaveCount(3);
    await page.clock.runFor(100);
    // The first three expired together; the queued fourth is now visible.
    await expect(toastCloseButtons(page)).toHaveCount(1);
    await expect(toast(page, '更新に失敗しました')).toHaveCount(1);

    await toastCloseButtons(page).click();
    await expect(toastCloseButtons(page)).toHaveCount(0);
  });

  test('every route survives a reload (SPA fallback)', async ({ page, request, api }) => {
    const routes = [
      ['/reports?status=new', '通報一覧', 1],
      ['/reports/new', '新規登録', 1],
      ['/reports/5', null, 1],
      ['/board', 'ボード', 2],
      ['/stats?from=2026-11-01&to=2026-11-20', '統計', 1],
      ['/no/such/page', 'ページが見つかりません', 1],
    ];
    const summary = await api.get('/api/reports/summary');
    // Reload only once the page has settled (data shown, event streams connected): reloading
    // mid-request makes WebKit report the cancelled requests as page errors.
    const settled = async (heading, streams) => {
      if (heading) await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      else await expect(page.getByText('通報 #5', { exact: true })).toBeVisible();
      await expect(page.getByText(`新規 ${summary.new} 件`)).toBeVisible();
      await expect(page.getByLabel('担当者')).toHaveValue('1');
      await expect.poll(() => api.openStreams()).toBe(streams);
    };
    for (const [path, heading, streams] of routes) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      // (the author's asked for React's <div id="root">; the example's page has no such wrapper. What the line is for:
      //  the server answers the route with the app's page, so the SPA starts on it)
      expect(await response.text()).toContain('<wcs-state');

      await page.goto(path);
      await settled(heading, streams);
      await page.reload();
      await settled(heading, streams);
    }
  });

  test('the first load of each route sends each GET exactly once', async ({ page, api }) => {
    const routes = [
      ['/reports', ['/api/staff', '/api/reports/summary', '/api/reports']],
      ['/reports/27', ['/api/staff', '/api/reports/summary', '/api/reports/27', '/api/reports/27/comments']],
      ['/reports/new', ['/api/staff', '/api/reports/summary']],
      ['/board', ['/api/staff', '/api/reports/summary', '/api/reports/board']],
      ['/stats', ['/api/staff', '/api/reports/summary', '/api/reports/export']],
    ];
    for (const [path, expected] of routes) {
      await api.reset();
      await page.goto(path);
      await expect.poll(async () => (await api.requests({ method: 'GET' })).map((e) => e.path).sort()).toEqual([...expected].sort());
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const gets = await api.requests({ method: 'GET' });
      const keys = gets.map((e) => `${e.path}?${new URLSearchParams(e.query)}`);
      expect(new Set(keys).size, `${path}: ${keys.join(', ')}`).toBe(keys.length);
    }
  });

  test('the console stays clean through a walk across all routes', async ({ page, consoleMessages }) => {
    await page.goto('/');
    await expect(reportRows(page)).toHaveCount(20);
    await reportRows(page).first().getByRole('link').click();
    await expect(page.getByRole('heading', { level: 2, name: 'コメント' })).toBeVisible();
    await page.getByRole('link', { name: '前の通報' }).click();
    await expect(page.getByRole('textbox', { name: 'コメント' })).toBeVisible();
    await page.getByRole('link', { name: '新規登録' }).click();
    await expect(page.getByLabel('件名')).toBeVisible();
    await page.getByRole('link', { name: 'ボード' }).click();
    await expect(page.getByRole('region', { name: '新規', exact: true }).getByRole('article').first()).toBeVisible();
    await page.getByRole('link', { name: '統計' }).click();
    await expect(page.getByRole('list', { name: '状態別件数' })).toBeVisible();
    await page.getByRole('button', { name: '7日' }).click();
    await expect(page).toHaveURL(/from=/);
    await page.getByRole('button', { name: /テーマ/ }).click();
    await page.goto('/missing');
    await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
    await page.getByRole('link', { name: 'トップへ戻る' }).click();
    await expect(reportRows(page)).toHaveCount(20);
    expect(consoleMessages).toEqual([]);
  });
});
}
