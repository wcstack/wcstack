/**
 * DOM イベント起点のハンドラが投げたときの着地（指摘 17 / 18）。
 *
 * `event/handler.ts` は `createStateAsync` を使うので、ハンドラの**同期 throw** も
 * `async` 関数の中で reject に変わり、DOM のイベント配送には届かない。戻り Promise を
 * 捨てていたため unhandled rejection に沈み、README の「throws at event time」とも
 * `captureHandlerRejection.ts` の「同期 throw はここを通らない」とも食い違っていた。
 * 投げ返せない経路なので、`console.error` の報告に落とす。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let seq = 0;

const unhandled: unknown[] = [];
const onUnhandled = (event: PromiseRejectionEvent | any): void => {
  unhandled.push(event?.reason ?? event);
  event?.preventDefault?.();
};
// happy-dom / node のどちらでも拾えるように両方掛ける
(globalThis as any).addEventListener?.("unhandledrejection", onUnhandled);
process.on?.("unhandledRejection", onUnhandled);

afterEach(() => { unhandled.length = 0; });

async function mount(state: Record<string, any>, body: string) {
  const host = document.createElement(`ehe-${++seq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${body}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(state);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  return { host, shadowRoot };
}

function captureConsoleError(): { calls: unknown[][]; restore: () => void } {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { calls.push(args); };
  return { calls, restore: () => { console.error = original; } };
}

describe("DOM イベントハンドラの同期 throw", () => {
  it("state メソッドが同期で投げても、unhandled rejection にせず報告すること", async () => {
    const { host, shadowRoot } = await mount(
      { boom() { throw new Error("SYNC-BOOM"); } },
      `<button data-wcs="onclick: boom"></button>`,
    );
    const captured = captureConsoleError();
    try {
      (shadowRoot.querySelector("button") as HTMLElement).click();
      await flush(); await flush();
      const messages = captured.calls.map((c) => `${String(c[0])} ${String((c[1] as Error)?.message ?? "")}`);
      expect(messages.some((m) => m.includes('"boom" rejected') && m.includes("SYNC-BOOM"))).toBe(true);
    } finally {
      captured.restore();
    }
    await flush();
    expect(unhandled.map((u) => String((u as Error)?.message ?? u))).not.toContain("SYNC-BOOM");
    host.remove();
  });

  it("$command の綴り間違い（CommandToken に解決しない）も報告されること", async () => {
    const { host, shadowRoot } = await mount(
      { $commandTokens: ["real"], other: 1 },
      `<button data-wcs="onclick: $command.typo"></button>`,
    );
    const captured = captureConsoleError();
    try {
      (shadowRoot.querySelector("button") as HTMLElement).click();
      await flush(); await flush();
      const messages = captured.calls.map((c) => `${String(c[0])} ${String((c[1] as Error)?.message ?? "")}`);
      expect(messages.some((m) => m.includes("did not resolve to a CommandToken"))).toBe(true);
    } finally {
      captured.restore();
    }
    host.remove();
  });
});
