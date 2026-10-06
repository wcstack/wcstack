import { test, expect, type Page, type Locator } from "@playwright/test";
import { collectErrors } from "./helpers";

// examples/state-devtools-playground — <wcs-devtools> の 3 ペイン（State / Wiring /
// Timeline）全部に仕事をさせる最小ページ。ページ自身は state + timer で、カウンタ
// （素の write と算出 getter）、ToDo（リスト・ワイルドカード getter・$eqIndex の
// 鍵付き選択）、時計（command-token で <wcs-timer> を start / stop し、event-token の
// tick で seconds を進める）を持つ。
//
// この spec は 2 つを固定する。(1) ページの機能がそのまま動くこと。(2) devtools の
// オーバーレイが DevTools Hook Protocol 越しに 4.0 のエンジンを見られること — State
// ペインの状態ツリーとインライン編集、Wiring ペインのライブ台帳・パスのハイライト・
// pick、Timeline の write / batch / command / event 行と空撃ちの警告、カバレッジ。
//
// パネルは既定で下にドックして画面の下 45vh を覆い、その下のボタンのクリックを奪う
// （README「パネルを開いている間はページの一部が覆われる」）。そこでビューポートを
// 広げ、パネルを右にドックしてページの本文（中央 640px）と重ならないようにする。
// <wcs-timer> の 1 秒刻みは page.clock で進める。

test.use({ viewport: { width: 1600, height: 1000 } });

const URL_ = "/examples/state-devtools-playground/";

const devtools = (page: Page) => page.locator("wcs-devtools");
const badge = (page: Page) => devtools(page).locator(".badge");
const panel = (page: Page) => devtools(page).locator(".panel");
const pane = (page: Page, name: "state" | "wiring" | "timeline") =>
  devtools(page).locator(`.pane-${name} .pane-body`);
/** State ペインの、キーが `key` の行 */
const treeRow = (page: Page, key: string): Locator =>
  pane(page, "state").locator(".tree-row").filter({
    has: page.locator(".key", { hasText: new RegExp(`^${key.replace(/[[\]]/g, "\\$&")}:$`) }),
  });

const counter = (page: Page) => page.locator("section").nth(0);
const todoSection = (page: Page) => page.locator("section").nth(1);
const clockSection = (page: Page) => page.locator("section").nth(2);
const todoRows = (page: Page) => todoSection(page).locator("ul:not(.hint) > li");

/** バインドが済み、{{ }} が値に置き換わるまで待つ */
async function ready(page: Page): Promise<void> {
  await expect(counter(page).locator(".big")).toHaveText("0");
  await expect(clockSection(page).locator(".big")).toHaveText("0s");
  await expect(todoRows(page)).toHaveCount(3);
  expect(await page.locator("body").innerText()).not.toContain("{{");
}

/** バッジで開き、右にドックする（本文と重ならない位置） */
async function openDocked(page: Page): Promise<void> {
  await badge(page).click();
  await expect(panel(page)).toBeVisible();
  await devtools(page).getByRole("button", { name: "dock" }).click();
  await expect(panel(page)).toHaveClass(/\bdock-right\b/);
}

type TimelineRow = { kind: string; label: string; detail: string; warn: boolean };

async function timelineRows(page: Page): Promise<TimelineRow[]> {
  return pane(page, "timeline").locator(".timeline-row").evaluateAll((rows) =>
    rows.map((row) => {
      const kind = row.querySelector(".kind")!;
      return {
        kind: kind.textContent!.trim(),
        label: row.querySelector(".label")!.textContent!.trim(),
        detail: row.querySelector(".detail")!.textContent!.trim(),
        warn: kind.classList.contains("warn"),
      };
    }),
  );
}

test.describe("examples/state-devtools-playground — ページの機能", () => {
  test("カウンタ: +1 で count と算出 getter double が更新される", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);
    await expect(counter(page)).toContainText("double = 0");

    for (let i = 1; i <= 3; i++) {
      await counter(page).getByRole("button", { name: "+1" }).click();
      await expect(counter(page).locator(".big")).toHaveText(String(i));
      await expect(counter(page)).toContainText(`double = ${i * 2}`);
    }

    expect(errors).toEqual([]);
  });

  test("ToDo: 追加・空入力の無視・チェックの切り替えと残数・タイトルのクリックでの選択（$eqIndex）", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);
    const heading = todoSection(page).locator("h2");
    await expect(heading).toHaveText("Todos (3 left)");
    await expect(todoRows(page).locator(".box")).toHaveText(["☐", "☐", "☐"]);

    // 追加（双方向の value: と、クリックのハンドラ）
    const input = todoSection(page).getByPlaceholder("new todo");
    await input.fill("write the e2e spec");
    await todoSection(page).getByRole("button", { name: "add" }).click();
    await expect(todoRows(page)).toHaveCount(4);
    await expect(todoRows(page).nth(3).locator(".title")).toHaveText("write the e2e spec");
    await expect(todoRows(page).nth(3).locator(".box")).toHaveText("☐");
    await expect(input).toHaveValue("");
    await expect(heading).toHaveText("Todos (4 left)");

    // 空白だけの入力は足さない
    await input.fill("   ");
    await todoSection(page).getByRole("button", { name: "add" }).click();
    await expect(todoRows(page)).toHaveCount(4);

    // チェック: 行 getter の ☑ と class.done、$getAll を読む remaining が追従する
    const first = todoRows(page).nth(0);
    await first.locator(".box").click();
    await expect(first.locator(".box")).toHaveText("☑");
    await expect(first.locator(".title")).toHaveClass(/\bdone\b/);
    await expect(heading).toHaveText("Todos (3 left)");
    await todoRows(page).nth(3).locator(".box").click();
    await expect(heading).toHaveText("Todos (2 left)");
    await first.locator(".box").click();
    await expect(first.locator(".box")).toHaveText("☐");
    await expect(first.locator(".title")).not.toHaveClass(/\bdone\b/);
    await expect(heading).toHaveText("Todos (3 left)");

    // 選択: 選ばれるのはクリックした行だけで、別の行を選ぶと移る
    await todoRows(page).nth(2).locator(".title").click();
    await expect(todoSection(page).locator(".title.selected")).toHaveCount(1);
    await expect(todoRows(page).nth(2).locator(".title")).toHaveClass(/\bselected\b/);
    await todoRows(page).nth(0).locator(".title").click();
    await expect(todoSection(page).locator(".title.selected")).toHaveCount(1);
    await expect(todoRows(page).nth(0).locator(".title")).toHaveClass(/\bselected\b/);

    expect(errors).toEqual([]);
  });

  test("時計: command-token で <wcs-timer> を start / stop し、event-token の tick が seconds を進める", async ({ page }) => {
    const errors = collectErrors(page);
    await page.clock.install();
    await page.goto(URL_);
    await ready(page);
    const seconds = clockSection(page).locator(".big");
    // ここから時間は手で進める
    await page.clock.pauseAt(Date.now() + 60_000);

    // <wcs-timer manual> は start されるまで刻まない
    await page.clock.runFor(3000);
    await expect(seconds).toHaveText("0s");

    await clockSection(page).getByRole("button", { name: "start", exact: true }).click();
    await page.clock.runFor(3000);
    await expect(seconds).toHaveText("3s");

    await clockSection(page).getByRole("button", { name: "stop", exact: true }).click();
    await page.clock.runFor(5000);
    await expect(seconds).toHaveText("3s");

    // 再開すると続きから数える（seconds は state が持つ）
    await clockSection(page).getByRole("button", { name: "start", exact: true }).click();
    await page.clock.runFor(1000);
    await expect(seconds).toHaveText("4s");
    await clockSection(page).getByRole("button", { name: "stop", exact: true }).click();

    // 購読者ゼロのコマンドの空撃ちは、ページにとってはただの無害な emit
    await clockSection(page).getByRole("button", { name: "fire ghost command" }).click();
    await page.clock.runFor(2000);
    await expect(seconds).toHaveText("4s");

    expect(errors).toEqual([]);
  });
});

test.describe("examples/state-devtools-playground — <wcs-devtools> のオーバーレイ", () => {
  test("バッジ・Alt+Shift+D・× で開閉し、State ペインがページの状態ツリーを出す", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);
    // devtools/auto は <body> に 1 つだけ足す
    await expect(devtools(page)).toHaveCount(1);
    await expect(badge(page)).toHaveText("WCS");
    await expect(panel(page)).toBeHidden();

    // パネルを閉じたままページを操作してから開く: 開いた時点の状態が出る
    await counter(page).getByRole("button", { name: "+1" }).click();
    await counter(page).getByRole("button", { name: "+1" }).click();
    await todoRows(page).nth(0).locator(".box").click();
    await todoRows(page).nth(2).locator(".title").click();
    await expect(counter(page).locator(".big")).toHaveText("2");

    await openDocked(page);
    await expect(badge(page)).toBeHidden();
    // ページのルートの状態がひとつ、document として名簿に載る
    await expect(devtools(page).locator("header select option")).toHaveCount(1);
    await expect(devtools(page).locator("header select option")).toHaveText(/^document \(/);

    // 値のキーと getter が出て、メソッドと $ の宣言キーは出ない
    await expect(pane(page, "state").locator(".tree-row .key")).toHaveText([
      "count:", "double:", "newTitle:", "todos:", "selectedIndex:", "remaining:", "seconds:", "running:",
    ]);
    await expect(treeRow(page, "count").locator(".value")).toHaveText("2");
    await expect(treeRow(page, "double").locator(".value")).toHaveText("4");
    await expect(treeRow(page, "newTitle").locator(".value")).toHaveText('""');
    await expect(treeRow(page, "selectedIndex").locator(".value")).toHaveText("2");
    await expect(treeRow(page, "remaining").locator(".value")).toHaveText("2");
    await expect(treeRow(page, "running").locator(".value")).toHaveText("false");

    // 配列は展開できる。行の中は行のパス（todos.*）で読む
    await treeRow(page, "todos").locator(".toggle").click();
    await expect(treeRow(page, "[2]")).toHaveCount(1);
    await expect(pane(page, "state").locator(".tree-row .key")).toContainText(["[0]:", "[1]:", "[2]:"]);
    await treeRow(page, "[0]").locator(".toggle").click();
    await expect(treeRow(page, "done").locator(".value")).toHaveText("true");
    await expect(treeRow(page, "title").locator(".value")).toHaveText('"open the devtools overlay"');

    // $eqIndex の鍵付き購読: 行ごとの購読ではなくリストの監視 1 つと、最後の値
    const keyed = pane(page, "state").locator(".keyed-row");
    await expect(pane(page, "state").locator(".overlays-heading")).toHaveText("Keyed selection (1 path)");
    await expect(keyed.locator(".path")).toHaveText("selectedIndex");
    await expect(keyed.locator(".detail")).toHaveText("list watchers 1 · last 2");

    // ホットキーで閉じて開く
    await page.keyboard.press("Alt+Shift+D");
    await expect(panel(page)).toBeHidden();
    await expect(badge(page)).toBeVisible();
    await page.keyboard.press("Alt+Shift+D");
    await expect(panel(page)).toBeVisible();
    // 右ドックのまま × で閉じる
    await expect(panel(page)).toHaveClass(/\bdock-right\b/);
    await devtools(page).getByRole("button", { name: "×" }).click();
    await expect(panel(page)).toBeHidden();
    await expect(badge(page)).toBeVisible();

    expect(errors).toEqual([]);
  });

  // 以前は右ドック（幅 420px）でヘッダーの中身が幅を超え（scrollWidth 467 > 418）、
  // × がパネルとビューポートの右の外に押し出されていた。今はタイトルと中間の操作が
  // 縮み（足りなければ中間が横にスクロールし）、dock と × は常に見えている。
  test("ヘッダーは幅を超えず、× は右ドック・下ドック・狭いビューポートのどれでも見えて押せる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);
    const close = devtools(page).getByRole("button", { name: "×" });
    const dock = devtools(page).getByRole("button", { name: "dock" });

    /** ヘッダーが溢れておらず、dock と × がパネルとビューポートの内側に収まっている */
    async function expectHeaderFits(): Promise<void> {
      const fit = await devtools(page).evaluate((host) => {
        const shadow = host.shadowRoot!;
        const header = shadow.querySelector("header")!;
        const panelBox = shadow.querySelector(".panel")!.getBoundingClientRect();
        const inside = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.left >= panelBox.left && r.right <= panelBox.right
            && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
        };
        return {
          overflow: header.scrollWidth - header.clientWidth,
          dock: inside(shadow.querySelector('button[data-role="dock"]')!),
          close: inside(shadow.querySelector('button[data-role="close"]')!),
        };
      });
      expect(fit).toEqual({ overflow: 0, dock: true, close: true });
    }

    const layouts = [
      { width: 1600, height: 1000, dock: "right" },
      { width: 1280, height: 720, dock: "right" },
      { width: 1280, height: 720, dock: "bottom" },
      // 携帯の幅: 下ドックはビューポートいっぱい、右ドックはビューポートより広い 420px
      { width: 360, height: 640, dock: "bottom" },
      { width: 420, height: 640, dock: "right" },
    ] as const;
    for (const layout of layouts) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await badge(page).click();
      await expect(panel(page)).toBeVisible();
      if (!(await panel(page).getAttribute("class"))!.includes(`dock-${layout.dock}`)) {
        await dock.click();
      }
      await expect(panel(page)).toHaveClass(new RegExp(`\\bdock-${layout.dock}\\b`));
      await expectHeaderFits();
      // 実際に押せる（ほかの要素に遮られていない）
      await close.click();
      await expect(panel(page)).toBeHidden();
    }

    expect(errors).toEqual([]);
  });

  test("State ペインのインライン編集は通常のパイプラインを通り、ページと算出 getter に届く", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);
    await openDocked(page);

    await treeRow(page, "count").locator(".value").click();
    const editor = treeRow(page, "count").locator("input");
    await expect(editor).toBeFocused();
    await editor.fill("42");
    await editor.press("Enter");

    await expect(counter(page).locator(".big")).toHaveText("42");
    await expect(counter(page)).toContainText("double = 84");
    await expect(treeRow(page, "count").locator(".value")).toHaveText("42");
    await expect(treeRow(page, "double").locator(".value")).toHaveText("84");

    // 文字列の値も編集でき、双方向の <input> に届く
    await treeRow(page, "newTitle").locator(".value").click();
    await treeRow(page, "newTitle").locator("input").fill("from devtools");
    await treeRow(page, "newTitle").locator("input").press("Enter");
    await expect(todoSection(page).getByPlaceholder("new todo")).toHaveValue("from devtools");

    expect(errors).toEqual([]);
  });

  test("Wiring ペイン: ライブの配線台帳、パスのクリックで束縛ノードをハイライト、pick でページ要素の配線", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);
    await openDocked(page);
    const wiring = pane(page, "wiring");

    // devtools を先に読んでいるので declared のフォールバックではない
    await expect(wiring.locator(".notice")).toHaveCount(0);
    // 台帳に載るのは状態のパスを購読するバインディング（on*: と token のバインディングは
    // パスを持たない）。マークアップから数える: 直下の {{ count }} {{ double }}
    // {{ remaining }} {{ seconds }} と value: newTitle、for: todos、行ごとに {{ .box }}
    // class.done class.selected {{ .title }} の 4 本 × 3 行
    const expectedRows = (rowCount: number) => [
      "for for ← todos",
      "prop value ← newTitle",
      "text textContent ← count",
      "text textContent ← double",
      "text textContent ← remaining",
      "text textContent ← seconds",
      ...Array.from({ length: rowCount }, () => [
        "prop class.done ← todos.*.done",
        "prop class.selected ← todos.*.selected",
        "text textContent ← todos.*.box",
        "text textContent ← todos.*.title",
      ]).flat(),
    ].sort();
    const wiringRows = async () =>
      (await wiring.locator(".wiring-row").evaluateAll((rows) => rows.map((r) => r.textContent!.trim().replace(/\s+/g, " ")))).sort();

    await expect(wiring).toContainText(`context: all — ${expectedRows(3).length} live bindings`);
    expect(await wiringRows()).toEqual(expectedRows(3));

    // 行を足すと、その行のバインディングが台帳に加わる
    await todoSection(page).getByPlaceholder("new todo").fill("fourth");
    await todoSection(page).getByRole("button", { name: "add" }).click();
    await expect(todoRows(page)).toHaveCount(4);
    await expect(wiring).toContainText(`context: all — ${expectedRows(4).length} live bindings`);
    expect(await wiringRows()).toEqual(expectedRows(4));

    // State ペインのパスのクリック: そのパスの配線に絞り、束縛ノードの上に枠を出す
    await treeRow(page, "count").locator(".key").click();
    await expect(wiring).toContainText("context: count — 1 live binding");
    const box = devtools(page).locator(".hl-box");
    await expect(box).toHaveCount(1);
    const target = (await counter(page).locator(".big").boundingBox())!;
    const style = (await box.getAttribute("style"))!;
    const px = (prop: string) => Number(new RegExp(`${prop}: ([\\d.]+)px`).exec(style)![1]);
    expect(px("left")).toBeCloseTo(target.x, 0);
    expect(px("top")).toBeCloseTo(target.y, 0);
    expect(px("width")).toBeCloseTo(target.width, 0);
    expect(px("height")).toBeCloseTo(target.height, 0);
    // 枠はクリック時のスナップショットで、2 秒で消える
    await expect(box).toHaveCount(0, { timeout: 5000 });

    // pick: 次のクリックを奪ってページ要素を選ぶ。ページのハンドラ（selectTodo）は走らない
    await devtools(page).getByRole("button", { name: "⌖ pick" }).click();
    await todoRows(page).nth(1).locator(".title").click();
    await expect(wiring).toContainText("context: <span> — 3 live bindings");
    expect((await wiringRows())).toEqual([
      "prop class.done ← todos.*.done",
      "prop class.selected ← todos.*.selected",
      "text textContent ← todos.*.title",
    ]);
    await expect(todoSection(page).locator(".title.selected")).toHaveCount(0);
    // pick は 1 回で抜け、次のクリックはページに届く
    await todoRows(page).nth(1).locator(".title").click();
    await expect(todoRows(page).nth(1).locator(".title")).toHaveClass(/\bselected\b/);

    expect(errors).toEqual([]);
  });

  test("Timeline: write → batch、command（空撃ちは警告）、tick の event → write → batch、カバレッジ", async ({ page }) => {
    const errors = collectErrors(page);
    await page.clock.install();
    await page.goto(URL_);
    await ready(page);
    await openDocked(page);

    await counter(page).getByRole("button", { name: "+1" }).click();
    await clockSection(page).getByRole("button", { name: "fire ghost command" }).click();
    await expect.poll(async () => (await timelineRows(page)).map((r) => `${r.kind} ${r.label}`)).toContain("command ghost");
    let rows = await timelineRows(page);
    expect(rows[0]).toMatchObject({ kind: "element-registered", label: "document" });
    const write = rows.findIndex((r) => r.kind === "write" && r.label === "count");
    expect(rows[write]).toMatchObject({ detail: "1 (was 0)", warn: false });
    expect(rows[write + 1]).toMatchObject({ kind: "batch", label: "1 address", detail: "count" });
    // 購読者ゼロの emit は警告表示（whenDefined 前の配線レースを見つけるための印）
    expect(rows.find((r) => r.label === "ghost")).toEqual({
      kind: "command", label: "ghost", detail: '"nobody is listening"', warn: true,
    });

    // 時計: start は購読者 1 のコマンド、tick ごとに event → write(seconds) → batch
    await page.clock.pauseAt(Date.now() + 60_000);
    await clockSection(page).getByRole("button", { name: "start", exact: true }).click();
    await page.clock.runFor(2000);
    await clockSection(page).getByRole("button", { name: "stop", exact: true }).click();
    await page.clock.runFor(100);
    await expect(clockSection(page).locator(".big")).toHaveText("2s");
    await expect.poll(async () => (await timelineRows(page)).map((r) => `${r.kind} ${r.label}`)).toContain("command stopClock");
    rows = await timelineRows(page);
    // startClock() は running を書いてから emit する。1 回の操作の行は write / command の後に batch
    const fromStart = rows.slice(rows.findIndex((r) => r.kind === "write" && r.label === "running"));
    expect(fromStart.map((r) => `${r.kind} ${r.label} ${r.detail}`.trim())).toEqual([
      "write running true (was false)",
      "command startClock",
      "batch 1 address running",
      "event clockTick [[CustomEvent]]",
      "write seconds 1 (was 0)",
      "batch 1 address seconds",
      "event clockTick [[CustomEvent]]",
      "write seconds 2 (was 1)",
      "batch 1 address seconds",
      "write running false (was true)",
      "command stopClock",
      "batch 1 address running",
    ]);
    expect(fromStart.filter((r) => r.warn)).toEqual([]);

    // カバレッジ: 宣言したトークンを、観測以降に emit されたかで突き合わせる
    await pane(page, "wiring").getByRole("button", { name: "coverage" }).click();
    await page.clock.runFor(100);
    const coverage = pane(page, "wiring");
    await expect(coverage).toContainText("observing since");
    const coverageRow = (name: string) => coverage.locator(".wiring-row").filter({ hasText: new RegExp(` ${name} `) });
    await expect(coverageRow("startClock")).toContainText("command");
    await expect(coverageRow("startClock")).toContainText("emitted");
    await expect(coverageRow("stopClock")).toContainText("emitted");
    await expect(coverageRow("ghost")).toContainText("emitted-unheard");
    await expect(coverageRow("ghost").locator(".badge-tag.warn")).toHaveCount(1);
    await expect(coverageRow("clockTick")).toContainText("eventToken");
    await expect(coverageRow("clockTick")).toContainText("emitted ×2");

    expect(errors).toEqual([]);
  });

  test("遅れてアタッチした devtools（4.0）も、その時点のバインディングをライブの台帳として受け取る", async ({ page }) => {
    // 3.x のランタイムは binding 台帳を列挙できず、バインディング構築後にアタッチした
    // devtools は declared のフォールバックしか出せなかった。4.0 は アタッチ時に今ある
    // バインディングをすべて state:binding-added として送る（docs/devtools-hook-protocol
    // §6 の 4.0 の注記）。ページから devtools の script を外して読み込み、バインドと
    // 操作が済んでから注入する。
    const errors = collectErrors(page);
    await page.route(`**${URL_}`, async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(/<script type="module" src="[^"]*\/devtools\/[^"]*"><\/script>/, "");
      expect(html).not.toContain("/devtools/");
      await route.fulfill({ response, body: html });
    });
    await page.goto(URL_);
    await ready(page);
    await expect(devtools(page)).toHaveCount(0);
    await counter(page).getByRole("button", { name: "+1" }).click();
    await expect(counter(page).locator(".big")).toHaveText("1");

    await page.addScriptTag({ type: "module", url: "/packages/devtools/dist/auto.min.js" });
    await expect(devtools(page)).toHaveCount(1);
    await openDocked(page);

    await expect(pane(page, "wiring")).toContainText("context: all — 18 live bindings");
    await expect(pane(page, "wiring").locator(".notice")).toHaveCount(0);
    await expect(pane(page, "wiring").locator(".badge-tag.declared")).toHaveCount(0);
    await expect(treeRow(page, "count").locator(".value")).toHaveText("1");
    await expect(treeRow(page, "double").locator(".value")).toHaveText("2");

    // 以後の操作はタイムラインに流れる
    await counter(page).getByRole("button", { name: "+1" }).click();
    await expect.poll(async () => (await timelineRows(page)).map((r) => `${r.kind} ${r.label} ${r.detail}`)).toContain("write count 2 (was 1)");

    expect(errors).toEqual([]);
  });

  // 以前はパネルを開いたままページを操作すると、Timeline には write が流れるのに State
  // ペインの値は古いまま残った（timeline の変化で timeline ペインしか描き直していなかった。
  // docs/devtools-tag-design.md §10 G-U1 は丸ごとの再描画を決めていた）。今は更新バッチの
  // たびに読み直す — timeline を一時停止していても。
  test("開いたままのパネルの State ペインが、ページからの書き込みに追従する（展開はそのまま・一時停止中も）", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(URL_);
    await ready(page);
    await openDocked(page);
    await expect(treeRow(page, "count").locator(".value")).toHaveText("0");

    await counter(page).getByRole("button", { name: "+1" }).click();
    await expect(counter(page).locator(".big")).toHaveText("1");
    await expect(treeRow(page, "count").locator(".value")).toHaveText("1");
    await expect(treeRow(page, "double").locator(".value")).toHaveText("2");

    // 展開した枝は読み直しても開いたまま、中の値も追従する
    await treeRow(page, "todos").locator(".toggle").click();
    await treeRow(page, "[0]").locator(".toggle").click();
    await expect(treeRow(page, "done").locator(".value")).toHaveText("false");
    await todoRows(page).nth(0).locator(".box").click();
    await expect(treeRow(page, "done").locator(".value")).toHaveText("true");
    await expect(treeRow(page, "remaining").locator(".value")).toHaveText("2");
    await todoRows(page).nth(2).locator(".title").click();
    await expect(treeRow(page, "selectedIndex").locator(".value")).toHaveText("2");
    await expect(pane(page, "state").locator(".keyed-row .detail")).toHaveText("list watchers 1 · last 2");

    // timeline の一時停止が止めるのは記録だけ: State ペインは追従し続ける
    await devtools(page).getByRole("button", { name: "⏸" }).click();
    const recorded = (await timelineRows(page)).length;
    await counter(page).getByRole("button", { name: "+1" }).click();
    await expect(treeRow(page, "count").locator(".value")).toHaveText("2");
    expect((await timelineRows(page)).length).toBe(recorded);

    // 何も起きていなければ描き直さない（読み直しがループしていない）: 同じ行の DOM が
    // 何フレーム経っても残っている
    const sameRow = await treeRow(page, "count").elementHandle();
    await page.evaluate(() => new Promise<void>((resolve) => {
      let frames = 10;
      const next = () => (--frames === 0 ? resolve() : requestAnimationFrame(next));
      requestAnimationFrame(next);
    }));
    expect(await sameRow!.evaluate((row) => row.isConnected)).toBe(true);

    expect(errors).toEqual([]);
  });

  test("インライン編集の入力欄は、時計の刻みで State ペインが読み直されても消えず、確定・取り消しの後に追いつく", async ({ page }) => {
    const errors = collectErrors(page);
    await page.clock.install();
    await page.goto(URL_);
    await ready(page);
    await openDocked(page);
    await page.clock.pauseAt(Date.now() + 60_000);
    const seconds = treeRow(page, "seconds").locator(".value");

    await clockSection(page).getByRole("button", { name: "start", exact: true }).click();
    await page.clock.runFor(1000);
    // 時計を止めているので、パネルの描き直し（rAF）にも時間を進める
    await page.clock.runFor(100);
    await expect(seconds).toHaveText("1");

    // 編集を始めてから 3 回刻む: 打ちかけの入力欄はそのまま、ペインは描き直しを待つ
    await treeRow(page, "count").locator(".value").click();
    const editor = treeRow(page, "count").locator("input");
    await editor.fill("42");
    await page.clock.runFor(3000);
    await expect(clockSection(page).locator(".big")).toHaveText("4s");
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("42");
    await expect(seconds).toHaveText("1");

    // Enter で確定すると、書き込みがページに届き、待たせていた分も描かれる
    await editor.press("Enter");
    await page.clock.runFor(100);
    await expect(counter(page).locator(".big")).toHaveText("42");
    await expect(treeRow(page, "count").locator(".value")).toHaveText("42");
    await expect(seconds).toHaveText("4");

    // Escape で取り消しても追いつく
    await treeRow(page, "newTitle").locator(".value").click();
    await treeRow(page, "newTitle").locator("input").fill("never written");
    await page.clock.runFor(1000);
    await expect(seconds).toHaveText("4");
    await treeRow(page, "newTitle").locator("input").press("Escape");
    await page.clock.runFor(100);
    await expect(treeRow(page, "newTitle").locator("input")).toHaveCount(0);
    await expect(treeRow(page, "newTitle").locator(".value")).toHaveText('""');
    await expect(seconds).toHaveText("5");
    await expect(todoSection(page).getByPlaceholder("new todo")).toHaveValue("");

    await clockSection(page).getByRole("button", { name: "stop", exact: true }).click();
    expect(errors).toEqual([]);
  });
});
