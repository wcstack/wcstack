/**
 * filters.split-page.test.ts — 算術・型変換・欠損値のフィルタ（4.0.0-rc.3 まではコア、以後は formats
 * 機能）をページで使う。/core だけのページ（formats なし）では formats 機能を案内する壁で落ち、
 * formats を入れれば動く。
 * このファイルは最初の it まで formats を入れない（＝ /core だけのページ）。
 */
import { describe, it, expect, vi } from "vitest";
import { bootstrapState, getBindingsReady } from "../src/element";
import { installFeatures } from "../src/hooks";
import { formats } from "../src/features/formats";

let seq = 0;

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`split-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  return { root, el };
}

describe("/core だけのページ（formats なし）と formats を入れたページ", () => {
  it("formats の無いページで add を書くと、formats 機能を案内する壁で落ちる（filter-unknown の番号ではない）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    bootstrapState();
    const { el } = await page("<p>{{ n|add(1) }}</p>", { n: 1 });
    await expect(el.connectedCallbackPromise).rejects.toThrow(
      '[@wcstack/state] [wcs/filter-unknown] filter not found: add. "add" is in the formats add-on — install it with installFeatures([formats]) from "@wcstack/state/features/formats".',
    );
    error.mockRestore();
  });

  it("formats を入れたページでは add も coalesce も int も動く", async () => {
    installFeatures([formats]);
    const { root, el } = await page("<p>{{ n|add(1) }}</p><i>{{ m|coalesce(0)|int }}</i>", { n: 1, m: null });
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    expect(root.querySelector("p")!.textContent).toBe("2");
    expect(root.querySelector("i")!.textContent).toBe("0");
  });
});
