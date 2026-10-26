import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/shift-desk — サポートデスクの担当者コンソール（継ぎ目アプリ、docs/seam-apps.md の shift-desk）。
// 一つの勤務のあいだ開いたままのページが時間から受けるもの: 時計とタイマー、閉じられずに途絶えた接続、
// パラメータだけの移動でのルートの中の I/O ノード、<wcs-head> と何百回の移動、bfcache、真夜中、期限の切れる
// トークン、オフラインの送信待ち、二つのタブ。
//
// この spec はその意図を実ブラウザで固定する: 起きたことはサーバーの見え方（/api/test/state の接続・参加の記録）と
// 画面の両方で見る。時間は Playwright の時計（ページのタイマー・Date・rAF だけを動かす）とサーバーの時計の
// フック（/api/test/time）を揃えて進める。閉じられずに途絶えた接続は、サーバーが書くのをやめて閉じない
// フック（/api/test/blackhole）で作る。隠れたタブはヘッドレスでは作れない（visibilityState は常に visible）ので、
// 通知の試験はページの中で visibilityState を上書きする。bfcache は headless shell では復元されないので、
// その試験だけ channel "chromium" を --disable-back-forward-cache なしで自分で立ち上げる。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）でワーカーごとに 5700 + 10 × index のポートで立てる
// （4600–4900 / 5100 / 5200 / 5300–5540 は他の spec）。アプリは localhost、離れる先の別オリジンは 127.0.0.1。
const PORT = 5700 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const APP = `http://localhost:${PORT}`;
const OTHER = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const TZ = "Asia/Tokyo";

let server: ChildProcess;

test.use({ timezoneId: TZ });

test.beforeAll(async () => {
  if (!existsSync(resolve(REPO_ROOT, "examples/shift-desk/node_modules/ws/package.json"))) {
    throw new Error("examples/shift-desk has no node_modules: cd examples/shift-desk && npm ci");
  }
  server = spawn(process.execPath, ["examples/shift-desk/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT), TZ },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("shift-desk server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Demo server running")) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`shift-desk server exited with ${code}`)); });
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
  await hook("/api/test/reset");
  await hook("/api/test/tick?ms=0");          // 新しいチケットは試験が自分で作る
  await hook("/api/test/ping?ms=20000");
  await hook("/api/test/token-ttl?ms=900000");
});

// --- helpers -------------------------------------------------------------------

async function hook(path: string): Promise<any> {
  const res = await fetch(APP + path, { method: "POST" });
  expect(res.status, path).toBe(200);
  return res.json();
}
type ServerState = {
  now: number; seq: number; open: number; openIds: number[]; today: { date: string; opened: number; closed: number; breached: number };
  connections: { streams: number; chats: number[] }; streams: { since: number | null; lastEventId: string | null }[];
  joins: { ticket: number; user: string }[]; tickets: Record<string, { claimedBy: string | null; status: string; messages: number }>;
};
const serverState = async (): Promise<ServerState> => (await fetch(`${APP}/api/test/state`)).json();
const serverTicket = async (id: number): Promise<{ messages: { from: string; text: string }[] }> => (await fetch(`${APP}/api/test/ticket?id=${id}`)).json();

/** state の読み取り（試験のための窓口。アプリのコードではない） */
async function readState<T>(page: Page, fn: (s: any) => T): Promise<T> {
  return page.evaluate(async (src) => {
    const el = document.querySelector("wcs-state") as any;
    let out: any;
    await el.createStateAsync("readonly", async (s: any) => { out = (0, eval)(`(${src})`)(s); });
    return out;
  }, fn.toString());
}
const queueIds = (page: Page) => readState(page, (s) => s.queue.map((t: any) => t.id) as number[]);
async function expectQueueEqualsServer(page: Page, timeout = 15_000): Promise<void> {
  await expect.poll(async () => {
    const [ids, st] = await Promise.all([queueIds(page), serverState()]);
    return [...ids].sort((a, b) => a - b).join(",") === [...st.openIds].sort((a, b) => a - b).join(",") ? "equal" : `page ${ids.length} / server ${st.open}`;
  }, { timeout }).toBe("equal");
}

async function login(page: Page, user = "ana"): Promise<void> {
  await page.goto(`${APP}/login`);
  await page.locator("section.login input[name=user]").fill(user);
  await page.locator("section.login input[name=password]").fill("pw");
  await page.locator("section.login button[type=submit]").click();
  await expect(page.locator("section.queue tbody tr.row").first()).toBeVisible();
  await expect(page.locator(".conn")).toHaveText("Live");
  await expectQueueEqualsServer(page);
}
/** 状態の読み込みと束縛まで待つ（深いリンク・再読み込みのあと） */
async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => !!customElements.get("wcs-state") && !!customElements.get("wcs-router"));
  await page.evaluate(() => (document.querySelector("wcs-state") as any).connectedCallbackPromise);
}
async function openTicket(page: Page, id: number, query = ""): Promise<void> {
  await page.goto(`${APP}/tickets/${id}${query}`);
  await ready(page);
  await expect(page).toHaveTitle(new RegExp(`^#${id} `));
  await expect(page.locator("section.ticket .chat-state")).toHaveText("Chat connected");
}
/** ルーターのナビゲーション（文書は読み直さない: パラメータだけの移動） */
async function navigate(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => (document.querySelector("wcs-router") as any).navigate(p), path);
}
const unexpected = (messages: string[], ...allow: RegExp[]) => messages.filter((m) => !allow.some((re) => re.test(m)));
const httpError = (status: number) => new RegExp(`Failed to load resource: the server responded with a status of ${status}`);

// --- tests -------------------------------------------------------------------

test("キューはスナップショットとストリームでサーバーと一致し、新しいチケットが届き、深いリンクの再読み込みでもログインが続く", async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  await expectQueueEqualsServer(page);
  const before = (await serverState()).open;
  await hook("/api/test/burst?n=10");          // 2 件の作成と 8 件の更新
  await expectQueueEqualsServer(page);
  expect((await serverState()).open).toBe(before + 2);
  await expect(page.locator("section.queue h1 small")).toHaveText(`(${before + 2})`);

  const first = (await queueIds(page))[0];
  await page.locator("section.queue tbody tr.row").first().locator("a").click();
  await expect(page).toHaveURL(`${APP}/tickets/${first}`);
  await expect(page).toHaveTitle(new RegExp(`^#${first} .+ — Shift desk$`));
  await page.reload();
  await ready(page);
  await expect(page).toHaveURL(`${APP}/tickets/${first}`);
  await expect(page).toHaveTitle(new RegExp(`^#${first} `));
  await expect(page.locator(".conn")).toHaveText("Live");
  expect(errors).toEqual([]);
});

test("先に取られたチケットは 409 で誰が先かを示し、自分で取って閉じたチケットはキューから消える", async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  const [a, b] = await queueIds(page);
  await openTicket(page, a);
  await expect(page.locator("section.ticket .meta")).toContainText("unclaimed");
  // もう一人の担当者が一瞬先に取る。こちらの画面はまだ「unclaimed」のつもりで Claim を押す
  const carl = await (await fetch(`${APP}/api/login`, { method: "POST", body: JSON.stringify({ user: "carl", password: "pw" }) })).json();
  await fetch(`${APP}/api/tickets/${a}/claim`, { method: "POST", headers: { Authorization: `Bearer ${carl.token}` } });
  await page.locator("section.ticket button", { hasText: "Claim" }).click();
  await expect(page.locator("section.ticket .actions .error")).toHaveText("carl claimed it first.");
  await expect(page.locator("section.ticket .meta")).toContainText("claimed by carl");   // ストリームが画面を追いつかせる

  await navigate(page, `/tickets/${b}`);
  await expect(page).toHaveTitle(new RegExp(`^#${b} `));
  await page.locator("section.ticket button", { hasText: "Claim" }).click();
  await expect(page.locator("section.ticket .meta")).toContainText("claimed by you");
  await page.locator("section.ticket button", { hasText: "Close ticket" }).click();
  await expect(page.locator("section.ticket .meta")).toContainText("closed");
  await navigate(page, "/");
  await expectQueueEqualsServer(page);
  expect(await queueIds(page)).not.toContain(b);
  expect(unexpected(errors, httpError(409))).toEqual([]);
});

test("パラメータだけのナビゲーションは新しいチケットのチャットにだけ入り、前のチケットの発言は混ざらない", async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  const [a, b] = await queueIds(page);
  await openTicket(page, a);
  const joinsBefore = (await serverState()).joins.length;

  await navigate(page, `/tickets/${b}`);
  await expect(page).toHaveTitle(new RegExp(`^#${b} `));
  await expect(page.locator("section.ticket .chat-state")).toHaveText("Chat connected");
  await expect.poll(async () => (await serverState()).connections.chats).toEqual([b]);
  // 移動のあとの参加は B だけ: 前のチケット A のチャットに入り直してから閉じることはない
  expect((await serverState()).joins.slice(joinsBefore).map((j) => j.ticket)).toEqual([b]);

  await hook(`/api/test/customer?ticket=${a}&text=${encodeURIComponent("written in A's chat")}`);
  await hook(`/api/test/customer?ticket=${b}&text=${encodeURIComponent("written in B's chat")}`);
  await expect(page.locator("section.ticket .chat")).toContainText("written in B's chat");
  await expect(page.locator("section.ticket .chat")).not.toContainText("written in A's chat");
  expect(errors).toEqual([]);
});

test("stale-after: 閉じられずに途絶えた接続を、ストリームもチャットも数秒で開き直し、キューが追いつく", async ({ page }) => {
  const errors = collectErrors(page);
  await hook("/api/test/tick?ms=500");          // 0.5 秒ごとのチケットと ping: 2.5 秒の沈黙は途絶えた接続
  await hook("/api/test/ping?ms=500");
  await login(page);
  const [a] = await queueIds(page);
  await openTicket(page, a, "?stale=2500");
  await expect(page.locator(".conn")).toHaveText("Live");
  const opened = (await serverState()).streams.at(-1)!.since!;          // スナップショットの位置
  await expect.poll(() => readState(page, (s) => s.seq)).toBeGreaterThan(opened + 2);   // その後のイベントが届く
  const streamsBefore = (await serverState()).streams.length;
  const joinsBefore = (await serverState()).joins.length;

  await hook("/api/test/blackhole");            // サーバーは書くのをやめ、接続は閉じない（スリープ、NAT、プロキシ）
  const silentFrom = (await serverState()).seq;
  await hook("/api/test/burst?n=10");           // 途絶えたストリームには届かないイベント
  await expect.poll(async () => (await serverState()).connections.streams, { timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await serverState()).connections.chats, { timeout: 15_000 }).toEqual([a]);
  const st = await serverState();
  expect(st.streams.length).toBeGreaterThan(streamsBefore);
  expect(st.joins.length).toBeGreaterThan(joinsBefore);
  // 開き直したストリームは、スナップショットの位置ではなくページが最後に適用した位置から尋ねる（新しい EventSource は
  // Last-Event-ID を送らない）: 途絶えたあとのイベントは送り直され、その前のものは送り直されない
  expect(st.streams.at(-1)!.since).toBeGreaterThan(opened + 2);
  expect(st.streams.at(-1)!.since).toBeLessThanOrEqual(silentFrom);
  await expectQueueEqualsServer(page);
  await expect.poll(() => readState(page, (s) => s.seq)).toBe((await serverState()).seq);
  await expect(page.locator(".conn")).toHaveText("Live");
  await expect(page.locator("section.ticket .chat-state")).toHaveText("Chat connected");
  expect(errors).toEqual([]);
});

test("スリープのあと（時計の空白）: ログインは求められず、トークンは更新され、キューが追いつき、通知は 1 件にまとまる", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: TZ, permissions: ["notifications"] });
  // 隠れたタブ（ヘッドレスでは作れない）と、作られた通知の記録
  await context.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get() { return hidden ? "hidden" : "visible"; } });
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get() { return hidden; } });
    (window as any).__setHidden = (h: boolean) => { hidden = h; document.dispatchEvent(new Event("visibilitychange")); };
    (window as any).__notifications = [];
    const Real = window.Notification;
    window.Notification = new Proxy(Real, {
      construct(target, args) { (window as any).__notifications.push(args[0]); return Reflect.construct(target, args); },
    });
  });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.clock.install({ time: (await serverState()).now });
  await hook("/api/test/tick?ms=20000");       // 20 秒ごとに 1 件: 1 時間で 180 件
  await login(page);
  const enable = page.locator("button", { hasText: "Enable notifications" });
  if (await enable.isVisible()) await enable.click();
  await expect.poll(() => readState(page, (s) => s.notifyPermission)).toBe("granted");
  await page.evaluate(() => (window as any).__setHidden(true));

  // 蓋が閉じる: ページのタイマーは 1 時間止まり、接続は閉じられないまま途絶え、トークンは切れる
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);
  await hook("/api/test/blackhole");
  await hook("/api/test/time?add=3600000");
  // 蓋が開く: 期限の来たタイマーが一度ずつ走る
  await page.clock.fastForward(3_600_000);
  await page.clock.resume();
  await hook(`/api/test/time?at=${await page.evaluate(() => Date.now())}`);

  await expectQueueEqualsServer(page, 20_000);
  await expect(page).toHaveURL(`${APP}/`);                         // ログインは求められない
  await expect(page.locator(".conn")).toHaveText("Live");
  // 眠っていたあいだの 180 件は、1 件ずつ知らせず「N new urgent tickets」にまとめる
  const notes = await page.evaluate(() => (window as any).__notifications as string[]);
  expect(notes.length).toBeGreaterThanOrEqual(1);
  expect(notes.length).toBeLessThanOrEqual(2);
  for (const n of notes) expect(n).toMatch(/^\d+ new urgent tickets?$/);
  // トークンは更新された。眠りのあいだに期限の来たタイマー（毎分の統計）は、起き上がりの処理が更新を待つあいだに
  // 古いトークンで走って 401 を受けることがある — それは更新のあとでやり直される
  expect(await readState(page, (s) => s["session.expiresAt"])).toBeGreaterThan((await serverState()).now);
  await expect(page.locator(".today .muted")).toHaveText("");
  expect(unexpected(errors, httpError(401))).toEqual([]);
  await context.close();
});

test("今日の数は地元の真夜中にゼロから数え直し、見出しの日付が変わる", async ({ page }) => {
  const errors = collectErrors(page);
  await hook(`/api/test/reset?at=${Date.parse("2026-10-26T23:58:30+09:00")}`);
  await hook("/api/test/tick?ms=20000");
  await page.clock.install({ time: (await serverState()).now });
  await login(page);
  const opened = page.locator(".today b").first();
  await expect.poll(async () => Number(await opened.textContent())).toBeGreaterThanOrEqual(25);
  await expect(page.locator(".today")).toContainText("Oct 26, 2026");
  // 2 分を 10 秒ずつ進め、サーバーの時計をページに揃える
  for (let i = 0; i < 12; i++) {
    await page.clock.runFor(10_000);
    await hook(`/api/test/time?at=${await page.evaluate(() => Date.now())}`);
  }
  await expect(page.locator(".today")).toContainText("Oct 27, 2026");
  const server = (await serverState()).today;
  expect(server.date).toBe("2026-10-27");
  await expect.poll(async () => Number(await opened.textContent())).toBeLessThan(10);
  expect(Number(await opened.textContent())).toBeLessThanOrEqual(server.opened);
  expect(errors).toEqual([]);
});

test("下書きはチケットごとに残る: 別のチケットには混ざらず、再読み込みのあとも戻る", async ({ page }) => {
  const errors = collectErrors(page);
  await login(page);
  const [a, b] = await queueIds(page);
  const box = page.locator("section.ticket textarea");
  await openTicket(page, a);
  await box.fill("Draft for A");
  await navigate(page, `/tickets/${b}`);
  await expect(page).toHaveTitle(new RegExp(`^#${b} `));
  await expect(box).toHaveValue("");
  await box.fill("Draft for B");
  await page.goBack();
  await expect(page).toHaveTitle(new RegExp(`^#${a} `));
  await expect(box).toHaveValue("Draft for A");
  await page.reload();
  await ready(page);
  await expect(box).toHaveValue("Draft for A");
  await navigate(page, `/tickets/${b}`);
  await expect(page).toHaveTitle(new RegExp(`^#${b} `));
  await expect(box).toHaveValue("Draft for B");
  expect(errors).toEqual([]);
});

test("オフラインで書いた返信は送信待ちに並び、つながると一度ずつ届く", async ({ page, context }) => {
  const errors = collectErrors(page);
  await login(page);
  const [a] = await queueIds(page);
  await openTicket(page, a);
  await context.setOffline(true);
  await expect(page.locator(".banner.offline")).toBeVisible();
  for (const text of ["Offline reply one", "Offline reply two"]) {
    await page.locator("section.ticket textarea").fill(text);
    await page.locator("section.ticket button", { hasText: "Send reply" }).click();
  }
  await expect(page.locator("section.ticket .outbox li")).toHaveCount(2);
  await context.setOffline(false);
  await expect(page.locator("section.ticket .outbox li")).toHaveCount(0);
  await expect.poll(async () => (await serverTicket(a)).messages.filter((m) => m.text.startsWith("Offline reply")).map((m) => m.text))
    .toEqual(["Offline reply one", "Offline reply two"]);
  await expect(page.locator("section.ticket .chat")).toContainText("Offline reply two");
  expect(unexpected(errors, /ERR_INTERNET_DISCONNECTED/, /WebSocket connection to .* failed/)).toEqual([]);
});

test("リフレッシュが拒まれたら、書きかけと送信待ちを残してログインへ。ログインし直すとチケットへ戻り、送信待ちは一度ずつ届く", async ({ page, context }) => {
  const errors = collectErrors(page);
  await login(page);
  const [a] = await queueIds(page);
  await openTicket(page, a);
  await context.setOffline(true);
  for (const text of ["Queued one", "Queued two"]) {
    await page.locator("section.ticket textarea").fill(text);
    await page.locator("section.ticket button", { hasText: "Send reply" }).click();
  }
  await page.locator("section.ticket textarea").fill("Half a reply, being writ");
  await hook("/api/test/revoke");
  await hook("/api/test/expire");
  await context.setOffline(false);

  await expect(page).toHaveURL(`${APP}/login?next=${encodeURIComponent(`/tickets/${a}`)}`);
  await expect(page.locator("section.login .error")).toHaveText("Your session ended. Log in again — your drafts are kept.");
  await page.locator("section.login input[name=user]").fill("ana");
  await page.locator("section.login input[name=password]").fill("pw");
  await page.locator("section.login button[type=submit]").click();
  await expect(page).toHaveURL(`${APP}/tickets/${a}`);
  await expect(page.locator("section.ticket textarea")).toHaveValue("Half a reply, being writ");
  await expect.poll(async () => (await serverTicket(a)).messages.filter((m) => m.text.startsWith("Queued")).map((m) => m.text))
    .toEqual(["Queued one", "Queued two"]);
  expect(unexpected(errors, httpError(401), /ERR_INTERNET_DISCONNECTED/, /WebSocket connection to .* failed/)).toEqual([]);
});

test("チケットを 100 回開いても DOM ノードは増えず、タイトルはそのチケットのもの", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await login(page);
  const ids = await queueIds(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const nodes = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    return metrics.find((m) => m.name === "Nodes")!.value;
  };
  // キューから開き、次のチケットへパラメータだけで移り、キューへ戻る（ルートの入れ替えとパラメータの移動の両方）
  const visit = async (i: number) => {
    const id = ids[i % ids.length];
    const next = ids[(i + 1) % ids.length];
    await navigate(page, `/tickets/${id}`);
    await expect(page).toHaveTitle(new RegExp(`^#${id} `));
    await navigate(page, `/tickets/${next}`);
    await expect(page).toHaveTitle(new RegExp(`^#${next} `));
    await navigate(page, "/");
    await expect(page).toHaveTitle("Queue — Shift desk");
  };
  for (let i = 0; i < 20; i++) await visit(i);
  const warm = await nodes();
  for (let i = 20; i < 120; i++) await visit(i);
  const after = await nodes();
  // 4.7.0 では束縛した <wcs-head><title> がタイトルの書き換えごとにノードを残した（この 100 往復で +400）。4.8.0 は 0
  expect(after - warm).toBeLessThan(60);
  expect(errors).toEqual([]);
});

test("別のサイトから Back で戻ると bfcache から復元され、チャットはつなぎ直され、キューは追いつく", async ({ playwright }) => {
  // headless shell は bfcache から復元しない。Playwright が付ける --disable-back-forward-cache も外す
  const browser = await playwright.chromium.launch({ channel: "chromium", ignoreDefaultArgs: ["--disable-back-forward-cache"] });
  try {
    const context = await browser.newContext({ timezoneId: TZ });
    await context.addInitScript(() => {
      window.addEventListener("pageshow", (e) => sessionStorage.setItem("__persisted", String(e.persisted)));
    });
    const page = await context.newPage();
    const errors = collectErrors(page);
    await login(page);
    const [a] = await queueIds(page);
    await navigate(page, `/tickets/${a}`);
    await expect(page.locator("section.ticket .chat-state")).toHaveText("Chat connected");
    await hook("/api/test/tick?ms=1000");      // 離れているあいだにチケットが来る
    const joinsBefore = (await serverState()).joins.length;

    await page.goto(`${OTHER}/elsewhere`);
    await expect.poll(async () => (await serverState()).connections.chats).toEqual([]);   // pagehide で閉じた
    await page.waitForTimeout(3000);
    await page.goBack({ waitUntil: "commit" });

    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("__persisted"))).toBe("true");
    await expect(page.locator("section.ticket .chat-state")).toHaveText("Chat connected");
    await expect.poll(async () => (await serverState()).connections.chats).toEqual([a]);
    expect((await serverState()).joins.length).toBeGreaterThan(joinsBefore);
    await expectQueueEqualsServer(page);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
});

test("二つのタブ: もう一方のタブが開いているチケットがキューに示され、そのタブを閉じると消える", async ({ page, context }) => {
  const errors = collectErrors(page);
  await login(page);
  const [, b] = await queueIds(page);
  const other = await context.newPage();
  await openTicket(other, b);
  const row = page.locator("section.queue tbody tr.row", { has: page.locator(`td:first-child:text-is("${b}")`) });
  await expect(row.locator(".tabs-here")).toHaveText("(open in another tab)");
  await expect(page.locator("section.queue .prefs")).toContainText("1 other tab open");
  await other.close({ runBeforeUnload: true });
  await expect(row.locator(".tabs-here")).toHaveText("");
  await expect(page.locator("section.queue .prefs")).toContainText("no other tab");
  expect(errors).toEqual([]);
});
