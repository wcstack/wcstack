/**
 * fixes-late-install.test.ts — F12（docs/state-engine-rewrite/v4-remaining.ja.md §2.5）: エンジンを
 * 作った後に temporal を入れても、そのエンジンの切断・再接続は失敗しない。
 * 後付けを入れる順番を変えるので、ほかのテストと別のファイルにする。
 */
import { it, expect, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));

it("F12 temporal を入れる前に作ったエンジンは、入れた後の切断・再接続でも動く", async () => {
  bootstrapState();
  const h = document.createElement("fix-late-page");
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state><p>{{ n }}</p>`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState({ n: 1 });
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  installFeatures([temporal]);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const onError = vi.fn();
  window.addEventListener("error", onError);
  try {
    h.remove();
    document.body.appendChild(h);
    await flush();
    el.createState("writable", (s: any) => { s.n = 2; });
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("2");
    expect(error).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("error", onError);
    error.mockRestore();
  }
});
