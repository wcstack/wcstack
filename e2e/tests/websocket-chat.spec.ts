import { test, expect, type BrowserContext, type Page, type WebSocketRoute } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/websocket-chat — 同じ Echo / Broadcast チャットを、同じ WebSocket サーバー
// （shared/server.js）の上で実装を変えて作ったもの。ここで扱うのはビルド不要の 3 つ:
//  - state   : <wcs-ws> を `...: ws` の spread で <wcs-state> に束ね、送信は command-token
//              （$command.wsSend → command.sendMessage:）。ログは for: + if:（eq フィルタ）
//  - vanilla : WebSocketCore を @wc-bindable/core の bind() で素の DOM に流す
//              （@wc-bindable/core は esm.run から読む。serve.mjs の書き換え対象外なのでネットワークが要る）
//  - signals : WebSocketCore を @wcstack/signals/dom の bindNode() で signal にし、h()/For() で描く
// react / vue は Vite のビルドを要し @wcstack/state も使わないので対象外。
//
// デモ自身のサーバー（ws 依存）は立てない。/ws は page.routeWebSocket() で
// shared/server.js と同じプロトコルを話すモック（ChatHub）に差し替える:
//   client → server: {type:"echo",content} / {type:"broadcast",content,from}
//   server → client: echo（送り手だけ）/ broadcast（全員。from 無しは "anonymous"）/
//                    stats {clients, uptime}（本物は 3 秒ごと。ここではテストが送る）
// 各ページは /shared/style.css（デモのサーバーは websocket-chat/ をルートとして配る）を
// 読むので、そのファイルを page.route() で返す。
//
// この spec が固定するもの: 接続状態の表示、stats の表示、Echo は送り手だけに返る、
// Broadcast はニックネーム付きで全員に届く（他人の発言も同じ形で出る）、送信ボタンの
// 有効・無効、Enter での送信、Clear、接続失敗の表示と auto-reconnect（3 秒）による回復、
// サーバーからの切断後の再接続、3 つの実装が 1 つのサーバーで互いに broadcast できること。

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const STYLE = resolve(REPO_ROOT, "examples/websocket-chat/shared/style.css");

type Stack = "state" | "vanilla" | "signals";
const STACKS: Stack[] = ["state", "vanilla", "signals"];
const pageUrl = (stack: Stack) => `/examples/websocket-chat/${stack}/`;

/** shared/server.js と同じプロトコルを話すモック。複数のページ（クライアント）を束ねられる */
class ChatHub {
  /** いま開いているクライアント（サーバーの clientCount にあたる） */
  readonly clients = new Set<WebSocketRoute>();
  /** これまでに張られたソケット（閉じたものを含む） */
  readonly all: WebSocketRoute[] = [];
  /** クライアントから届いたメッセージ（生の文字列） */
  readonly received: string[] = [];
  /** true の間は本物のサーバーへ通す: serve.mjs は WebSocket を受けないので接続が失敗する */
  refuse = false;
  /** 送るメッセージに付ける timestamp（表示される時刻を独立に計算できるよう固定する） */
  now = Date.UTC(2026, 9, 7, 3, 4, 5);

  async attach(target: Page | BrowserContext): Promise<void> {
    await target.routeWebSocket(/\/ws$/, (ws) => {
      this.all.push(ws);
      if (this.refuse) {
        ws.connectToServer();
        return;
      }
      this.clients.add(ws);
      ws.onMessage((data) => this.onMessage(ws, String(data)));
      // onClose を付けると既定の転送が止まるので、ページ側の close イベントは自分で返す
      ws.onClose((code, reason) => {
        this.clients.delete(ws);
        void ws.close({ code, reason });
      });
    });
  }

  private onMessage(ws: WebSocketRoute, data: string): void {
    this.received.push(data);
    const timestamp = this.now;
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === "echo") {
        ws.send(JSON.stringify({ type: "echo", content: parsed.content, timestamp }));
      } else if (parsed.type === "broadcast") {
        this.broadcast({ type: "broadcast", content: parsed.content, from: parsed.from || "anonymous", timestamp });
      } else {
        ws.send(JSON.stringify({ type: "echo", content: data, timestamp }));
      }
    } catch {
      ws.send(JSON.stringify({ type: "echo", content: data, timestamp }));
    }
  }

  broadcast(message: object): void {
    for (const ws of this.clients) ws.send(JSON.stringify(message));
  }

  /** 他のクライアントの発言を流す（サーバーが broadcast するのと同じ形） */
  broadcastFrom(from: string, content: string): void {
    this.broadcast({ type: "broadcast", content, from, timestamp: this.now });
  }

  /** stats を全員に送り、送った値を返す */
  sendStats(uptime: number): { clients: number; uptime: number } {
    const stats = { clients: this.clients.size, uptime };
    this.broadcast({ type: "stats", ...stats });
    return stats;
  }

  latest(): WebSocketRoute {
    return this.all[this.all.length - 1];
  }
}

/** /shared/style.css をデモのサーバーと同じく websocket-chat/shared/ から返す */
async function serveSharedStyle(target: Page | BrowserContext): Promise<void> {
  await target.route(/\/shared\/style\.css$/, (route) => route.fulfill({ path: STYLE, contentType: "text/css; charset=utf-8" }));
}

/** 3 つの実装に共通の DOM（同じ shared/style.css のクラスで組んである） */
function ui(page: Page) {
  return {
    dot: page.locator(".status .dot"),
    label: page.locator(".status > span:not(.dot)"),
    clients: page.locator(".stat-badge strong").nth(0),
    uptime: page.locator(".stat-badge strong").nth(1),
    error: page.locator(".callout.error"),
    echoInput: page.locator('input[placeholder="Echo message…"]'),
    echoSend: page.locator("button.btn-echo"),
    broadcastInput: page.locator('input[placeholder="Broadcast message…"]'),
    broadcastSend: page.locator("button.btn-broadcast"),
    nickname: page.locator('input[placeholder="Nickname"]'),
    clear: page.getByRole("button", { name: "Clear" }),
    entries: page.locator(".log .log-entry"),
    empty: page.locator(".log .log-empty"),
  };
}

async function open(page: Page, stack: Stack, hub: ChatHub): Promise<ReturnType<typeof ui>> {
  await serveSharedStyle(page);
  await hub.attach(page);
  await page.goto(pageUrl(stack));
  const u = ui(page);
  await expect(u.label).toHaveText("Connected");
  // どの実装もソケットは 1 本だけ張る（<wcs-ws> の二重接続の回帰）
  expect(hub.all).toHaveLength(1);
  return u;
}

/** ページのロケールで timestamp を時刻にする（各実装は toLocaleTimeString() で出す） */
const timeText = (page: Page, ts: number) => page.evaluate((t) => new Date(t).toLocaleTimeString(), ts);

// 意図して起こした接続失敗（refuse）について Chromium が出すログだけを除く
const isRefusedLog = (e: string) => /WebSocket connection to 'ws:\/\/[^']+\/ws' failed/.test(e);

for (const stack of STACKS) {
  test.describe(`examples/websocket-chat/${stack}`, () => {
    test("接続すると Connected、stats で Clients / Uptime が出る", async ({ page }) => {
      const errors = collectErrors(page);
      const hub = new ChatHub();
      const u = await open(page, stack, hub);

      await expect(u.dot).toHaveClass(/\blive\b/);
      await expect(u.error).toBeHidden();
      // stats が届くまでは "—"
      await expect(u.clients).toHaveText("—");
      await expect(u.uptime).toHaveText("—");
      await expect(u.empty).toHaveText("Messages will appear here after connecting.");

      const stats = hub.sendStats(42);
      expect(stats.clients).toBe(1);
      await expect(u.clients).toHaveText("1");
      await expect(u.uptime).toHaveText("42s");
      // stats はログに積まない
      await expect(u.entries).toHaveCount(0);
      const next = hub.sendStats(45);
      await expect(u.uptime).toHaveText(`${next.uptime}s`);
      expect(errors).toEqual([]);
    });

    test("Echo は送り手にだけ返る。Send は接続中かつ入力ありのときだけ有効、Enter でも送れる", async ({ page }) => {
      const errors = collectErrors(page);
      const hub = new ChatHub();
      const u = await open(page, stack, hub);
      const time = await timeText(page, hub.now);

      // 空の入力では送れない
      await expect(u.echoSend).toBeDisabled();
      await u.echoInput.fill("   ");
      await expect(u.echoSend).toBeDisabled();
      await u.echoInput.fill("hello");
      await expect(u.echoSend).toBeEnabled();

      await u.echoSend.click();
      await expect(u.entries).toHaveCount(1);
      await expect(u.entries.nth(0)).toHaveClass(/\blog-echo\b/);
      await expect(u.entries.nth(0)).toContainText("Echo: hello");
      await expect(u.entries.nth(0).locator(".log-time")).toHaveText(time);
      await expect(u.empty).toHaveCount(0);
      // 送ったら入力は空に戻り、ボタンも無効に戻る
      await expect(u.echoInput).toHaveValue("");
      await expect(u.echoSend).toBeDisabled();
      // 前後の空白は落として送る（プロトコルのとおりの JSON）
      expect(hub.received.map((d) => JSON.parse(d))).toEqual([{ type: "echo", content: "hello" }]);

      // Enter キーでも送れる
      await u.echoInput.fill("  second  ");
      await u.echoInput.press("Enter");
      await expect(u.entries).toHaveCount(2);
      await expect(u.entries.nth(1)).toContainText("Echo: second");
      await expect(u.echoInput).toHaveValue("");
      expect(JSON.parse(hub.received[1])).toEqual({ type: "echo", content: "second" });
      expect(errors).toEqual([]);
    });

    test("Broadcast はニックネーム付きで全員に届き、他人の発言も同じ形で出る。Clear で空に戻る", async ({ page }) => {
      const errors = collectErrors(page);
      const hub = new ChatHub();
      const u = await open(page, stack, hub);

      // 既定のニックネームは user-xxxx
      await expect(u.nickname).toHaveValue(/^user-[0-9a-z]{1,4}$/);
      await u.nickname.fill("alice");
      await expect(u.broadcastSend).toBeDisabled();
      await u.broadcastInput.fill("hi all");
      await u.broadcastSend.click();

      // 自分の発言も楽観的には出さず、サーバーの broadcast で届いたものを出す
      await expect(u.entries).toHaveCount(1);
      await expect(u.entries.nth(0)).toHaveClass(/\blog-broadcast\b/);
      await expect(u.entries.nth(0)).toContainText("[alice] hi all");
      await expect(u.broadcastInput).toHaveValue("");
      expect(JSON.parse(hub.received[0])).toEqual({ type: "broadcast", content: "hi all", from: "alice" });

      // 他のクライアントの発言（サーバーが全員に流す）
      hub.broadcastFrom("bob", "hello alice");
      await expect(u.entries).toHaveCount(2);
      await expect(u.entries.nth(1)).toHaveClass(/\blog-broadcast\b/);
      await expect(u.entries.nth(1)).toContainText("[bob] hello alice");

      // Enter でも送れる。Echo と Broadcast はログに到着順で混ざる
      await u.broadcastInput.fill("bye");
      await u.broadcastInput.press("Enter");
      await u.echoInput.fill("ping");
      await u.echoSend.click();
      await expect(u.entries).toHaveCount(4);
      await expect(u.entries.nth(2)).toContainText("[alice] bye");
      await expect(u.entries.nth(3)).toContainText("Echo: ping");

      // Clear: ログが空になり、案内が戻る。その後の受信はまた積まれる
      await u.clear.click();
      await expect(u.entries).toHaveCount(0);
      await expect(u.empty).toHaveText("Messages will appear here after connecting.");
      hub.broadcastFrom("carol", "after clear");
      await expect(u.entries).toHaveCount(1);
      await expect(u.entries.nth(0)).toContainText("[carol] after clear");
      expect(errors).toEqual([]);
    });

    test("接続に失敗するとエラーを出し、auto-reconnect で回復する。サーバーが切っても繋ぎ直す", async ({ page }) => {
      const errors = collectErrors(page);
      const hub = new ChatHub();
      hub.refuse = true;
      await serveSharedStyle(page);
      await hub.attach(page);
      await page.goto(pageUrl(stack));
      const u = ui(page);

      // ハンドシェイクの失敗: error が出て、送信はできない
      await expect(u.error).toBeVisible();
      await expect(u.error).toContainText("Connection Error");
      await expect(u.label).toHaveText("Disconnected");
      await expect(u.dot).not.toHaveClass(/\blive\b/);
      await u.echoInput.fill("lost");
      await expect(u.echoSend).toBeDisabled();

      // サーバーが戻ると、reconnect-interval（3 秒）の後に自分で繋ぎ直し、error も消える
      expect(hub.all).toHaveLength(1);
      hub.refuse = false;
      await expect(u.label).toHaveText("Connected", { timeout: 10_000 });
      expect(hub.all).toHaveLength(2);
      await expect(u.error).toBeHidden();
      await expect(u.dot).toHaveClass(/\blive\b/);
      await expect(u.echoSend).toBeEnabled();

      // サーバーからの切断（1000 以外のコード）でも同じく繋ぎ直す
      await hub.latest().close({ code: 4001, reason: "server restart" });
      await expect(u.label).toHaveText("Disconnected");
      await expect(u.echoSend).toBeDisabled();
      await expect(u.label).toHaveText("Connected", { timeout: 10_000 });
      expect(hub.all).toHaveLength(3);
      // 繋ぎ直したソケットでも送受信できる
      await u.echoSend.click();
      await expect(u.entries.last()).toContainText("Echo: lost");
      expect(errors.filter((e) => !isRefusedLog(e))).toEqual([]);
    });
  });
}

test.describe("examples/websocket-chat — 実装をまたいだ broadcast", () => {
  test("state / vanilla / signals を同じサーバーに繋ぐと、互いの broadcast が全員に届き、echo は送り手だけ", async ({ context }) => {
    const hub = new ChatHub();
    await serveSharedStyle(context);
    await hub.attach(context);

    const pages = {} as Record<Stack, { page: Page; u: ReturnType<typeof ui>; errors: string[] }>;
    for (const stack of STACKS) {
      const page = await context.newPage();
      const errors = collectErrors(page);
      await page.goto(pageUrl(stack));
      const u = ui(page);
      await expect(u.label).toHaveText("Connected");
      await u.nickname.fill(`${stack}-user`);
      pages[stack] = { page, u, errors };
    }
    // 3 ページで 3 本（二重接続なし）
    expect(hub.all).toHaveLength(3);
    expect(hub.clients.size).toBe(3);

    // stats: サーバーが数えた接続数が全員に出る
    hub.sendStats(7);
    for (const stack of STACKS) {
      await expect(pages[stack].u.clients).toHaveText("3");
      await expect(pages[stack].u.uptime).toHaveText("7s");
    }

    // 各実装から 1 回ずつ broadcast — 3 件がどのページにも同じ順で並ぶ
    for (const stack of STACKS) {
      const { u } = pages[stack];
      await u.broadcastInput.fill(`from ${stack}`);
      await u.broadcastSend.click();
      for (const other of STACKS) {
        await expect(pages[other].u.entries.last()).toContainText(`[${stack}-user] from ${stack}`);
      }
    }
    for (const stack of STACKS) {
      await expect(pages[stack].u.entries).toHaveCount(3);
    }

    // echo は送り手のページにだけ返る
    await pages.vanilla.u.echoInput.fill("only me");
    await pages.vanilla.u.echoSend.click();
    await expect(pages.vanilla.u.entries).toHaveCount(4);
    await expect(pages.vanilla.u.entries.last()).toContainText("Echo: only me");
    await expect(pages.state.u.entries).toHaveCount(3);
    await expect(pages.signals.u.entries).toHaveCount(3);

    for (const stack of STACKS) expect(pages[stack].errors).toEqual([]);
  });
});
