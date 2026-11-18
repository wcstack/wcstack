// Shared fixtures: every test resets the API, fails on an uncaught page error, and records the console.
import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { LoginResponse, Reservation, ReservationRequest, TestLogEntry } from "../../shared/api.ts";
import { API as API_PORT } from "./ports.ts";

export const API = `http://127.0.0.1:${API_PORT}`;

export interface ConsoleEntry {
  type: string;
  text: string;
}

/** Console lines a test expects (a refused request the browser logs as a failed resource). */
export const EXPECTED_HTTP = /Failed to load resource: the server responded with a status of (401|404|409|422|500)/;

interface Fixtures {
  consoleLog: ConsoleEntry[];
  /** asserts the console has no error and no warning (except what the pattern allows) */
  expectQuietConsole: (allow?: RegExp) => void;
  api: Api;
}

export class Api {
  async reset(today?: string): Promise<void> {
    const r = await fetch(`${API}/api/_test/reset`, { method: "POST", body: JSON.stringify(today ? { today } : {}) });
    expect(r.ok).toBe(true);
  }
  async today(): Promise<string> {
    return ((await (await fetch(`${API}/api/today`)).json()) as { today: string }).today;
  }
  async login(id: string): Promise<string> {
    const r = await fetch(`${API}/api/login`, { method: "POST", body: JSON.stringify({ id, phrase: `midori-${id.toLowerCase()}` }) });
    return ((await r.json()) as LoginResponse).token;
  }
  async post<T>(path: string, token: string, body: unknown): Promise<{ status: number; body: T }> {
    const r = await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as T };
  }
  async reserve(groupId: string, req: ReservationRequest): Promise<Reservation> {
    const r = await this.post<Reservation>("/api/reservations", await this.login(groupId), req);
    expect(r.status).toBe(201);
    return r.body;
  }
  async decide(id: number, decision: "approved" | "denied", reason?: string): Promise<number> {
    return (await this.post(`/api/reservations/${id}/decision`, await this.login("S01"), { decision, reason })).status;
  }
  async fail(path: string, status: number, times = 1): Promise<void> {
    await fetch(`${API}/api/_test/fail`, { method: "POST", body: JSON.stringify({ path, status, times }) });
  }
  async log(): Promise<TestLogEntry[]> {
    return (await (await fetch(`${API}/api/_test/log`)).json()) as TestLogEntry[];
  }
  async itemId(centerId: number, name: string): Promise<number> {
    const token = await this.login("G08");
    const r = await fetch(`${API}/api/items?center=${centerId}&per=500&q=${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await r.json()) as { items: { id: number; name: string }[] };
    const it = body.items.find((i) => i.name === name);
    if (!it) throw new Error(`no ${name} at ${centerId}`);
    return it.id;
  }
}

export function watchPage(page: Page, log: ConsoleEntry[]): void {
  page.on("console", (m) => {
    if (m.text().startsWith("[vite]")) return;
    log.push({ type: m.type(), text: m.text() });
  });
  page.on("pageerror", (e) => {
    log.push({ type: "pageerror", text: e.message });
  });
}

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const api = new Api();
    await api.reset();
    await use(api);
  },
  consoleLog: async ({ page }, use) => {
    const log: ConsoleEntry[] = [];
    watchPage(page, log);
    await use(log);
    const errors = log.filter((l) => l.type === "pageerror");
    expect(errors, "uncaught page errors").toEqual([]);
  },
  expectQuietConsole: async ({ consoleLog }, use) => {
    await use((allow?: RegExp) => {
      const bad = consoleLog.filter((l) => (l.type === "error" || l.type === "warning") && !(allow && allow.test(l.text)));
      expect(bad, "console errors / warnings").toEqual([]);
    });
  },
});

export { expect };

/** Waits until the page's <wcs-state> has bound and run its $connectedCallback. */
export async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => customElements.get("wcs-state") !== undefined);
  await page.evaluate(async () => {
    const el = document.querySelector("wcs-state") as (Element & { connectedCallbackPromise?: Promise<void> }) | null;
    await el?.connectedCallbackPromise;
  });
}

export async function signIn(page: Page, id: string, path = "/"): Promise<void> {
  await page.goto(path);
  await ready(page);
  if (!page.url().includes("/login")) return;
  await page.getByLabel("団体番号").fill(id);
  await page.getByLabel("あいことば").fill(`midori-${id.toLowerCase()}`);
  await page.getByRole("button", { name: "サインイン" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A second, separate browser (another person), signed in. */
export async function otherBrowser(browser: Browser, baseURL: string, id: string, log: ConsoleEntry[] = []): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  watchPage(page, log);
  await signIn(page, id);
  return { context, page };
}

/** Reads a state value (for checks only; the tests act through the page). */
export async function stateValue<T>(page: Page, path: string): Promise<T> {
  return page.evaluate((p) => new Promise<T>((resolve) => {
    const el = document.querySelector("wcs-state") as unknown as { createState(m: "readonly", f: (s: Record<string, unknown>) => void): void };
    el.createState("readonly", (s) => resolve(JSON.parse(JSON.stringify(s[p] ?? null)) as T));
  }), path);
}

export function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
