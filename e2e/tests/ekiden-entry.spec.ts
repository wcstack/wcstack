import { test, expect, type CDPSession, type Locator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// examples/ekiden-entry — 市の駅伝のチーム参加申込（継ぎ目アプリ、docs/seam-apps.md の ekiden-entry）。ほとんどが
// フォームのページ: IME で打つ氏名とフリガナ、打ちながら整形する欄、3 種類の自動入力、並べ替えて動かす走者の行、
// 市の共通部品（フォーム関連カスタム要素）、別のステップの欄を名指す 422、2 つのタブで持つ下書き。初めての作者が
// 4.22.0 で書き、4.23.0 で要らなくなった回避策を外したもの: 変換中の欄を飛ばすコード（別のタブの下書き・住所の
// 検索）と、ガードに任せられなかった最初のナビゲーション。
//
// この spec は作者の確認（tests/e2e/*.spec.js）を意図として固定し、4.23 で変わった所を足す: 変換中の欄に別のタブの
// 下書きが届いても変換が切れないこと、遅いガードがリダイレクトした先のステップが束縛されていること。
// 本物の変換は Chromium の CDP（Input.imeSetComposition / Input.insertText）でしか動かせない。
// コンソールは wcstack の警告もエラーも無いこと。わざと起こした HTTP の失敗にブラウザ自身が出す
// "Failed to load resource" の行は、作者と同じく別に置く。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）でワーカーごとに 7900 + 10 × index のポートで立てる
// （4199–4900 / 5000–5540 / 5700– / 6100– / 7100– / 7300– / 7500– / 7700– は他の spec）。
const PORT = 7900 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const APP = `http://localhost:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const DRAFT_KEY = "midori-ekiden-draft";

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/ekiden-entry/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("ekiden-entry server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Demo server running")) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`ekiden-entry server exited with ${code}`)); });
  });
});

test.afterAll(() => {
  server?.kill();
});

// ---------------------------------------------------------------- the console

/** HTTP の失敗にブラウザ自身が出す行（ページのものではない） */
const NETWORK_LOG = /^Failed to load resource: (the server responded with a status of (404|409|413|415|422|500)|net::ERR_)/;

/** ページのエラー・警告を集める。テストの終わりに `clean()` で、何も無いことを確かめる */
function watch(page: Page): { clean(): void } {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (NETWORK_LOG.test(m.text())) return;
    problems.push(`${m.type()}: ${m.text()}`);
  });
  return { clean: () => expect(problems, "console errors / warnings").toEqual([]) };
}

test.beforeEach(async ({ request }) => {
  await request.post(`${APP}/api/_test/reset`);
});

// ---------------------------------------------------------------- the wizard, as a user fills it

let seq = 0;
const uniqueTeam = (): string => `テスト${Date.now() % 1000000}${++seq}`;
const draft = (page: Page): Promise<any> => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), DRAFT_KEY);

async function ready(page: Page): Promise<void> {
  await expect(page.locator("main h2")).toBeVisible();
  // （料金の合計は束縛が出す: 空でなければ、このステップは束縛されている）
  await expect(page.locator("#fee-total")).not.toBeEmpty();
}

async function setDate(page: Page, selector: string, iso: string): Promise<void> {
  const [y, m, d] = iso.split("-").map(Number);
  const host = page.locator(selector);
  await host.locator("[part=era]").selectOption("ad");
  await host.locator("[part=year]").fill(String(y));
  await host.locator("[part=month]").selectOption(String(m));
  await host.locator("[part=day]").selectOption(String(d));
}

const REP = {
  family: "山田", given: "花子", kanaFamily: "ヤマダ", kanaGiven: "ハナコ", birth: "1985-06-15",
  postal: "3790000", street: "中央1-2-3", phone: "09012345678", email: "hanako@example.jp",
};

async function fillTeam(page: Page, { team = uniqueTeam(), division = "一般" } = {}): Promise<string> {
  await page.fill("#team-name", team);
  await page.fill("#team-kana", "テスト");
  await page.locator(`input[name=division][value="${division}"]`).check();
  await page.fill("#rep-family", REP.family);
  await page.fill("#rep-given", REP.given);
  await page.fill("#rep-kana-family", REP.kanaFamily);
  await page.fill("#rep-kana-given", REP.kanaGiven);
  await setDate(page, "#rep-birth", REP.birth);
  await page.fill("#rep-postal", REP.postal);
  await expect(page.locator("#rep-city")).toHaveValue("みどり市");
  await page.fill("#rep-street", REP.street);
  await page.fill("#rep-phone", REP.phone);
  await page.fill("#rep-email", REP.email);
  await page.fill("#rep-email2", REP.email);
  return team;
}

const runnerRow = (page: Page, i: number): Locator => page.locator("li.runner").nth(i);

async function fillRunner(page: Page, i: number, { name, kana, best }: { name?: string; kana?: string; best?: string } = {}): Promise<void> {
  const row = runnerRow(page, i);
  await row.locator(".runner-name").fill(name ?? `走者${i + 1}　太郎`);
  await row.locator(".runner-kana").fill(kana ?? "ソウシャ　タロウ");
  await setDate(page, `li.runner:nth-child(${i + 1}) midori-date`, `199${i}-0${(i % 9) + 1}-1${i}`);
  await row.locator("input[type=radio][value=male]").check();
  await row.locator(".runner-best").fill(best ?? `2${i}${(i * 7) % 6}${i}`);
  await row.locator(".runner-shirt").selectOption("M");
}

async function fillRunners(page: Page, n = 5): Promise<void> {
  await expect(page.locator("li.runner").first()).toBeVisible();
  while ((await page.locator("li.runner").count()) < n) await page.click("#add-runner");
  for (let i = 0; i < n; i++) await fillRunner(page, i);
}

async function next(page: Page, path: string): Promise<void> {
  await page.click("#next");
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.locator("main h2")).toBeVisible();
}

/** 空の下書きから確認のステップまで */
async function toConfirm(page: Page): Promise<string> {
  await page.goto(`${APP}/entry/team`);
  await ready(page);
  const team = await fillTeam(page);
  await next(page, "/entry/runners");
  await fillRunners(page, 5);
  await next(page, "/entry/options");
  await page.locator("input[name=payment][value=cash]").check();
  await next(page, "/entry/confirm");
  return team;
}

// ---------------------------------------------------------------- a real IME (Chromium)

async function compose(cdp: CDPSession, steps: string[]): Promise<void> {
  for (const t of steps) await cdp.send("Input.imeSetComposition", { text: t, selectionStart: t.length, selectionEnd: t.length });
}
/** 変換を確定する Enter: Windows の Chrome が届ける形（変換中は keyCode 229 の keydown、確定、keyup 13） */
async function commitWithEnter(cdp: CDPSession, text: string): Promise<void> {
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
  await cdp.send("Input.insertText", { text });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
}
/** ローマ字で打ち、変換し、Enter で確定する */
async function typeJapanese(cdp: CDPSession, steps: string[], kanji: string): Promise<void> {
  await compose(cdp, steps);
  await compose(cdp, [kanji]);
  await commitWithEnter(cdp, kanji);
}
const YAMADA = ["y", "や", "やm", "やま", "やまd", "やまだ"];

// ================================================================ the entry

test("全ステップを打って申し込める。完了の後に戻っても、フォームは空", async ({ page }) => {
  const console_ = watch(page);
  const team = await toConfirm(page);
  await expect(page.locator("#c-team-name")).toContainText(team);
  await expect(page.locator("#c-rep-birth")).toHaveText("1985年6月15日");
  await expect(page.locator("#c-rep-phone")).toHaveText("090-1234-5678");
  await expect(page.locator("#c-total")).toContainText("¥12,000");
  await page.check("#agree");
  await page.click("#submit");
  await expect(page).toHaveURL(/\/entry\/done$/);
  await expect(page.locator("#receipt-id")).toHaveText(/^ME-2027-\d{4}$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/entry\/team$/);
  await expect(page.locator("#team-name")).toHaveValue("");
  console_.clean();
});

// ================================================================ the IME

test("IME で打った氏名は 山田、フリガナは ヤマダ。確定の Enter でステップは進まず、文字は重ならない", async ({ page }) => {
  const console_ = watch(page);
  await page.goto(`${APP}/entry/team`);
  await ready(page);
  const cdp = await page.context().newCDPSession(page);
  await page.focus("#rep-family");
  await typeJapanese(cdp, YAMADA, "山田");
  await expect(page.locator("#rep-family")).toHaveValue("山田");
  await expect(page.locator("#rep-kana-family")).toHaveValue("ヤマダ");
  await expect(page).toHaveURL(/\/entry\/team$/);
  await expect(page.locator("#rep-family-err")).toHaveText("");
  await expect.poll(async () => (await draft(page))?.rep.name.family).toBe("山田");
  expect((await draft(page)).rep.kana.family).toBe("ヤマダ");
  // チーム名に 2 語: 読みは足される
  await page.focus("#team-name");
  await typeJapanese(cdp, ["み", "みど", "みどり"], "緑");
  await typeJapanese(cdp, ["は", "はし", "はしr", "はしる"], "走る");
  await expect(page.locator("#team-name")).toHaveValue("緑走る");
  await expect(page.locator("#team-kana")).toHaveValue("ミドリハシル");
  await expect(page).toHaveURL(/\/entry\/team$/);
  console_.clean();
});

test("IME を入れたまま打った電話番号は、確定すると 090-1234-5678 になる", async ({ page }) => {
  const console_ = watch(page);
  await page.goto(`${APP}/entry/team`);
  await ready(page);
  const cdp = await page.context().newCDPSession(page);
  await page.focus("#rep-phone");
  const full = "０９０１２３４５６７８";
  await compose(cdp, [...full].map((_, i) => full.slice(0, i + 1)));
  // 変換中は、ページは欄を書き換えない
  await expect(page.locator("#rep-phone")).toHaveValue(full);
  await commitWithEnter(cdp, full);
  await expect(page.locator("#rep-phone")).toHaveValue("090-1234-5678");
  await expect.poll(async () => (await draft(page))?.rep.phone).toBe("09012345678");
  console_.clean();
});

// 4.23: 変換中の欄には state が書かない（forms add-on）。4.22 までは、別のタブの下書きが届くと変換が切れ、
// それまでの文字が確定してもう一度打たれた。作者はそのために、変換中の欄を飛ばすコードを持っていた
test("変換中の欄に別のタブの下書きが届いても、変換は切れない。打ち続けた文字が残り、もう 1 つのタブにも届く", async ({ page, context }) => {
  const console_ = watch(page);
  await page.goto(`${APP}/entry/team`);
  await ready(page);
  const other = await context.newPage();
  await other.goto(`${APP}/entry/team`);
  await ready(other);

  const cdp = await page.context().newCDPSession(page);
  await page.bringToFront();
  await page.focus("#rep-street");
  await compose(cdp, ["ち", "ちゅ", "ちゅう"]);
  // もう 1 つのタブが、同じ欄と別の欄を書く
  await other.fill("#rep-street", "別のタブ");
  await other.fill("#rep-building", "コーポ緑 101");
  // 別の欄には届く。変換中の欄は、打っている文字のまま
  await expect(page.locator("#rep-building")).toHaveValue("コーポ緑 101");
  await expect(page.locator("#rep-street")).toHaveValue("ちゅう");
  // 打ち続けて確定する
  await compose(cdp, ["ちゅうお", "ちゅうおう"]);
  await compose(cdp, ["中央"]);
  await commitWithEnter(cdp, "中央");
  await expect(page.locator("#rep-street")).toHaveValue("中央");
  await expect.poll(async () => (await draft(page))?.rep.street).toBe("中央");
  await expect(other.locator("#rep-street")).toHaveValue("中央");
  await expect(page).toHaveURL(/\/entry\/team$/);
  console_.clean();
});

test("電話番号の途中に打った数字の後ろに、キャレットが残る", async ({ page }) => {
  const console_ = watch(page);
  await page.goto(`${APP}/entry/team`);
  await ready(page);
  const phone = page.locator("#rep-phone");
  await phone.click();
  await page.keyboard.type("0901235678");          // 1 桁足りない
  await expect(phone).toHaveValue("090-1235-678");
  await phone.evaluate((el: HTMLInputElement) => el.setSelectionRange(7, 7));
  await page.keyboard.type("4");
  await expect(phone).toHaveValue("090-1234-5678");
  expect(await phone.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([8, 8]);
  await page.keyboard.press("Backspace");
  await expect(phone).toHaveValue("090-1235-678");
  expect(await phone.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(7);
  console_.clean();
});

// ================================================================ values the user did not type

const REP_AUTOFILL: Record<string, string> = {
  "#rep-family": "佐藤", "#rep-given": "健一", "#rep-kana-family": "さとう", "#rep-kana-given": "ｹﾝｲﾁ",
  "#rep-postal": "〒１６０－００２２", "#rep-pref": "13", "#rep-city": "新宿区", "#rep-street": "新宿3-1-1",
  "#rep-building": "みどりビル5F", "#rep-phone": "03 1234 5678", "#rep-email": "kenichi@example.jp", "#rep-email2": "kenichi@example.jp",
};

/** 自動入力とパスワード管理の代役: 複数の欄を 1 つのタスクで、ネイティブの setter から入れる */
async function autofill(page: Page, kind: string, values: Record<string, string>): Promise<void> {
  await page.evaluate(({ kind, values }) => {
    const els = Object.keys(values).map((sel) => document.querySelector(sel) as HTMLInputElement | HTMLSelectElement);
    els.forEach((el, i) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, Object.values(values)[i]);
    });
    for (const el of els) {
      if (kind === "input+change") el.dispatchEvent(new Event("input", { bubbles: true }));
      if (kind === "input+change" || kind === "change") el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, { kind, values });
}

for (const kind of ["input+change", "change", "none"]) {
  test(`代表者の自動入力（${kind}）が、打ったのと同じ形で確認のステップに届く`, async ({ page }) => {
    const console_ = watch(page);
    await page.goto(`${APP}/entry/team`);
    await ready(page);
    await page.fill("#team-name", uniqueTeam());
    await page.fill("#team-kana", "テスト");
    await page.locator('input[name=division][value="ミックス"]').check();
    await setDate(page, "#rep-birth", "1980-02-29");
    await autofill(page, kind, REP_AUTOFILL);
    // 入れた直後に「次へ」
    await next(page, "/entry/runners");
    await fillRunners(page, 5);
    await next(page, "/entry/options");
    await page.locator("input[name=payment][value=cash]").check();
    await next(page, "/entry/confirm");
    const summary = page.locator(".summary").first();
    await expect(summary).toContainText("佐藤　健一（サトウ　ケンイチ）");
    await expect(summary).toContainText("〒160-0022 東京都新宿区新宿3-1-1　みどりビル5F");
    await expect(page.locator("#c-rep-phone")).toHaveText("03-1234-5678");
    const d = await draft(page);
    expect(d.rep.postal).toBe("1600022");
    expect(d.rep.phone).toBe("0312345678");
    expect(d.rep.kana).toEqual({ family: "サトウ", given: "ケンイチ" });
    expect(d.rep.prefecture).toBe("13");
    console_.clean();
  });
}

// ================================================================ rows of inputs

test("走者 7 人。3 人目を外し、5 人目を氏名にフォーカスを置いたまま 2 つ上へ: フォーカスと開いた節は走者に付いていく", async ({ page }) => {
  const console_ = watch(page);
  page.on("dialog", (d) => d.accept());
  await page.goto(`${APP}/entry/team`);
  await ready(page);
  await fillTeam(page);
  await next(page, "/entry/runners");
  await page.click("#add-runner");
  await page.click("#add-runner");
  await expect(page.locator("li.runner")).toHaveCount(7);
  await expect(page.locator("#add-runner")).toBeDisabled();
  const names = ["一区　一郎", "二区　二郎", "三区　三郎", "四区　四郎", "五区　五郎", "補欠　六郎", "補欠　七郎"];
  for (let i = 0; i < 7; i++) await fillRunner(page, i, { name: names[i], kana: "テスト", best: `2${i}00` });
  await expect(page.locator("#fee-total")).toHaveText("¥14,000");
  const six = runnerRow(page, 5);
  await six.locator("summary").click();
  await six.locator(".runner-notes").fill("喘息あり");
  await runnerRow(page, 2).locator(".remove-runner").click();
  await expect(page.locator("li.runner")).toHaveCount(6);
  await expect(page.locator("#fee-total")).toHaveText("¥13,000");
  const name5 = runnerRow(page, 4).locator(".runner-name");
  await expect(name5).toHaveValue("補欠　六郎");
  await name5.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Alt+ArrowUp");
  const expected = ["一区　一郎", "二区　二郎", "補欠　六郎", "四区　四郎", "五区　五郎", "補欠　七郎"];
  for (let i = 0; i < 6; i++) await expect(runnerRow(page, i).locator(".runner-name")).toHaveValue(expected[i]);
  await expect(runnerRow(page, 2).locator(".runner-best")).toHaveValue("25:00");
  await expect(runnerRow(page, 2).locator("legend .leg")).toHaveText("3区");
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.value)).toBe("補欠　六郎");
  await expect(runnerRow(page, 2).locator("details")).toHaveAttribute("open", "");
  await expect(runnerRow(page, 2).locator(".runner-notes")).toHaveValue("喘息あり");
  for (const i of [0, 1, 3, 4, 5]) await expect(runnerRow(page, i).locator("details")).not.toHaveAttribute("open", "");
  console_.clean();
});

// ================================================================ the server's answer

test("ステップ 1 の欄と走者を断られる: その欄へ移り、並べ替えても文面は走者に付いていき、直すと送れる", async ({ page, request }) => {
  const console_ = watch(page);
  await toConfirm(page);
  await request.post(`${APP}/api/_test/reject`, { data: { times: 1, errors: {
    "rep.phone": "この電話番号には連絡できませんでした。別の番号を入力してください。",
    "runners.2.name": "この走者はすでに他のチームで申し込まれています。",
  } } });
  await page.check("#agree");
  await page.click("#submit");
  await expect(page).toHaveURL(/\/entry\/team$/);
  await expect(page.locator("#rep-phone")).toBeFocused();
  await expect(page.locator("#rep-phone")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#rep-phone-err")).toHaveText("この電話番号には連絡できませんでした。別の番号を入力してください。");
  await expect(page.locator(".steps li").nth(0)).toHaveClass(/has-error/);
  await expect(page.locator(".steps li").nth(1)).toHaveClass(/has-error/);
  await expect(page.locator(".steps li").nth(2)).not.toHaveClass(/has-error/);
  await page.fill("#rep-phone", "08011112222");
  await expect(page.locator("#rep-phone-err")).toHaveText("");
  await next(page, "/entry/runners");
  // 3 人目に文面がある。タイムの速い順に並べ替えても、その走者に付いている
  const third = await runnerRow(page, 2).locator(".runner-name").inputValue();
  await runnerRow(page, 2).locator(".runner-best").fill("1530");
  await expect(runnerRow(page, 2).locator(".runner-name")).toHaveAttribute("aria-invalid", "true");
  await page.click("#sort-runners");
  let at = -1;
  for (let i = 0; i < 5; i++) if ((await runnerRow(page, i).locator(".runner-name").inputValue()) === third) at = i;
  expect(at).toBeGreaterThanOrEqual(0);
  expect(at).not.toBe(2);
  await expect(runnerRow(page, at).locator(".runner-name")).toHaveAttribute("aria-invalid", "true");
  await expect(runnerRow(page, at).locator(".err").first()).toHaveText("この走者はすでに他のチームで申し込まれています。");
  for (let i = 0; i < 5; i++) if (i !== at) await expect(runnerRow(page, i).locator(".runner-name")).toHaveAttribute("aria-invalid", "false");
  await runnerRow(page, at).locator(".runner-name").fill("別人　花子");
  await expect(runnerRow(page, at).locator(".runner-name")).toHaveAttribute("aria-invalid", "false");
  await next(page, "/entry/options");
  await next(page, "/entry/confirm");
  await page.check("#agree");
  await page.click("#submit");
  await expect(page).toHaveURL(/\/entry\/done$/);
  await expect(page.locator("#receipt-id")).toHaveText(/^ME-2027-/);
  console_.clean();
});

// ================================================================ the draft, and where a URL leads

test("ステップ 3 で再読み込みしても全ステップの欄が戻る。片方のタブの変更は、もう片方に出る", async ({ page, context }) => {
  const console_ = watch(page);
  await page.goto(`${APP}/entry/team`);
  await ready(page);
  const team = await fillTeam(page);
  await next(page, "/entry/runners");
  await fillRunners(page, 6);
  await next(page, "/entry/options");
  await page.locator("#opt-parking [part=plus]").click();
  await page.locator("#opt-parking [part=plus]").click();
  await page.locator("#opt-lunch-ja [part=number]").fill("3");
  await page.fill("#opt-message", "よろしくお願いします🙏");
  await page.locator("input[name=payment][value=transfer]").check();
  await page.fill("#opt-transfer", "ﾐﾄﾞﾘ ﾀﾛｳ");
  await expect(page.locator("#opt-transfer")).toHaveValue("ミドリ タロウ");
  await expect(page.locator("#fee-total")).toHaveText("¥16,400");
  await page.reload();
  await ready(page);
  await expect(page).toHaveURL(/\/entry\/options$/);
  await expect(page.locator("#opt-parking [part=number]")).toHaveValue("2");
  await expect(page.locator("#opt-lunch-ja [part=number]")).toHaveValue("3");
  await expect(page.locator("#opt-message")).toHaveValue("よろしくお願いします🙏");
  await expect(page.locator("input[name=payment][value=transfer]")).toBeChecked();
  await expect(page.locator("#opt-receipt")).toHaveValue(team);
  await expect(page.locator("#fee-total")).toHaveText("¥16,400");
  await page.getByRole("link", { name: "戻る" }).click();
  await expect(page).toHaveURL(/\/entry\/runners$/);
  await expect(page.locator("li.runner")).toHaveCount(6);
  await expect(runnerRow(page, 5).locator(".runner-name")).toHaveValue("走者6　太郎");
  await expect(runnerRow(page, 0).locator("input[type=radio][value=male]")).toBeChecked();
  await expect(runnerRow(page, 0).locator("[part=year]")).toHaveValue("1990");
  await page.getByRole("link", { name: "戻る" }).click();
  await expect(page).toHaveURL(/\/entry\/team$/);
  await expect(page.locator("#team-name")).toHaveValue(team);
  await expect(page.locator("#rep-birth [part=year]")).toHaveValue("1985");
  await expect(page.locator("#rep-pref")).toHaveValue("10");
  await expect(page.locator("#rep-phone")).toHaveValue("090-1234-5678");
  await expect(page.locator("#rep-postal")).toHaveValue("379-0000");
  const other = await context.newPage();
  await other.goto(`${APP}/entry/team`);
  await expect(other.locator("#team-name")).toHaveValue(team);
  await page.fill("#rep-city", "みどり市大間々町");
  await expect(other.locator("#rep-city")).toHaveValue("みどり市大間々町");
  await other.fill("#rep-building", "コーポ緑 101");
  await expect(page.locator("#rep-building")).toHaveValue("コーポ緑 101");
  console_.clean();
});

// 4.23: ガードは、関数の中で lib/guards.js を import する（時間のかかるガード）。ページを読み込むナビゲーションを
// それがリダイレクトすると、4.22 までは行き先のステップが束縛されなかった。作者は最初のナビゲーションだけ
// ガードを通し、ページの側でやり直していた
test("下書きが空のまま後ろのステップを開くと、ガードがステップ 1 へ送る。そのステップは束縛されている @browsers", async ({ page }) => {
  const console_ = watch(page);
  for (const path of ["/entry/confirm", "/entry/runners", "/entry/done"]) {
    await page.goto(`${APP}${path}`);
    await expect(page).toHaveURL(/\/entry\/team$/);
    await ready(page);
  }
  // 束縛されている: 打った文字が下書きに届き、文字数が出る
  await page.fill("#team-name", "みどり走友会");
  await expect.poll(async () => (await draft(page))?.team.name).toBe("みどり走友会");
  // 1 秒待っても、差し込まれた束縛されないマークアップの警告（[wcs/inserted-unbound]）は出ない
  await page.waitForTimeout(1300);
  console_.clean();
});

test("/ と /entry は下書きの続きのステップへ送る。まだ入れないステップへは送らない @browsers", async ({ page }) => {
  const console_ = watch(page);
  await page.goto(`${APP}/`);
  await expect(page).toHaveURL(/\/entry\/team$/);
  await ready(page);
  await fillTeam(page);
  await next(page, "/entry/runners");
  await expect(page.locator("li.runner").first()).toBeVisible();
  // 走者のステップの途中で、入口から入り直す
  await page.goto(`${APP}/entry`);
  await expect(page).toHaveURL(/\/entry\/runners$/);
  await ready(page);
  await expect(page.locator("li.runner").first()).toBeVisible();
  // 走者が揃っていないので、確認へは入れない
  await page.goto(`${APP}/entry/confirm`);
  await expect(page).toHaveURL(/\/entry\/runners$/);
  await ready(page);
  console_.clean();
});

// ================================================================ the shared controls

test("/plain: 市の共通部品は wcstack が無くても、フォームの部品として働く（値・必須・reset・fieldset disabled）", async ({ page }) => {
  const console_ = watch(page);
  await page.goto(`${APP}/plain`);
  await page.fill("#plain-name", "みどり 太郎");
  await page.click("label[for=plain-birth]");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("plain-birth");
  expect(await page.evaluate(() => (document.getElementById("plain-form") as HTMLFormElement).checkValidity())).toBe(false);
  const birth = page.locator("#plain-birth");
  await birth.locator("[part=era]").selectOption("heisei");
  await birth.locator("[part=year]").fill("22");
  await birth.locator("[part=month]").selectOption("4");
  await birth.locator("[part=day]").selectOption("2");
  expect(await birth.evaluate((el: any) => el.value)).toBe("2010-04-02");
  await page.locator("#plain-count [part=plus]").click();
  await page.click("button[type=reset]");
  expect(await birth.evaluate((el: any) => el.value)).toBe("");
  expect(await page.locator("#plain-count").evaluate((el: any) => el.value)).toBe(1);
  await page.fill("#plain-name", "みどり 太郎");
  await birth.locator("[part=year]").fill("2010");
  await birth.locator("[part=month]").selectOption("4");
  await birth.locator("[part=day]").selectOption("2");
  await page.locator("#plain-count [part=plus]").click();
  await page.locator("#plain-count [part=plus]").click();
  await expect(page.locator("#plain-count [part=plus]")).toBeDisabled();
  await page.check("#plain-disable");
  await expect(birth.locator("[part=year]")).toBeDisabled();
  expect(await birth.evaluate((el: Element) => el.matches(":disabled"))).toBe(true);
  await page.uncheck("#plain-disable");
  await page.click("button[type=submit]");
  await expect(page.locator("h1")).toHaveText("受信した項目");
  await expect(page.locator('output[data-name="birth"]')).toHaveText("2010-04-02");
  await expect(page.locator('output[data-name="parking"]')).toHaveText("3");
  console_.clean();
});

test("ウィザードの中では、ラベルで共通部品にフォーカスが入り、送信中は部品を変えられない", async ({ page }) => {
  const console_ = watch(page);
  await page.goto(`${APP}/entry/team`);
  await ready(page);
  await page.click("label[for=rep-birth]");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("rep-birth");
  await toConfirm(page);
  // 遅いサーバー
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route("**/api/entries", async (route) => { await held; await route.continue(); });
  await page.check("#agree");
  await page.click("#submit");
  await expect(page.locator("#submit")).toBeDisabled();
  // 送っている間にステップ 3 へ戻る: 部品は変えられない
  await page.goBack();
  await expect(page).toHaveURL(/\/entry\/options$/);
  await expect(page.locator("#opt-parking [part=number]")).toBeDisabled();
  expect(await page.locator("#opt-parking").evaluate((el: Element) => el.matches(":disabled"))).toBe(true);
  release();
  await expect(page).toHaveURL(/\/entry\/done$/);
  console_.clean();
});
