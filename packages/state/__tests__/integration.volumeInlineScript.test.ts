/**
 * ボリューム（`<wcs-state mount="v">`）× インライン `<script type="module">`。
 *
 * `_loadStateFromSource` は**最初の await より前に同期で** `script[type="module"]` を引く。
 * ルート経路は `connectedCallback` の `await runPreparing(...)` がその手前に microtask 境界を
 * 1 つ挟むので、パース途中の upgrade（要素が先に接続され、子の `<script>` は後から付く）でも
 * script が見える。ボリュームは `runConnecting` の claim でその手前に return するため境界が無く、
 * script が `null` に見えて「API セット待ち」のフォールバック（`await this._setStatePromise`）に
 * 落ち、誰も resolve しないまま `connectedCallbackPromise` が**永久 pending**になっていた。
 *
 * SSR ではこれが致命的で、`waitForReady` が返らず `renderToString` の `finally`（＝ renderMutex の
 * 解放）に到達せず、**以後そのプロセスの健全なページまで永久に返らなくなる**（サイクル 4 指摘 3）。
 * サーバー側の回帰は `packages/server/__tests__/render.test.ts`。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r));
let counter = 0;

/** パース途中の upgrade を再現する: 要素を接続してから、同期で子の `<script>` を付ける */
function appendVolumeWithInlineScript(root: ShadowRoot, mountPath: string, source: string): State {
  const volume = document.createElement("wcs-state") as State;
  volume.setAttribute("mount", mountPath);
  root.appendChild(volume);
  const script = document.createElement("script");
  script.setAttribute("type", "module");
  script.textContent = source;
  volume.appendChild(script);
  return volume;
}

async function settledWithin(promise: Promise<unknown>, ms: number): Promise<string> {
  return Promise.race([
    promise.then(() => "resolved", (error) => `rejected: ${String(error)}`),
    new Promise<string>((r) => setTimeout(() => r("PENDING"), ms)),
  ]);
}

describe("ボリューム × インライン script", () => {
  it("接続の後に script が付く形でも、インライン script を読みに行き決着すること", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement(`vis-host-${++counter}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state json='{"root":1}'></wcs-state>`;
    document.body.appendChild(host);
    const volume = appendVolumeWithInlineScript(shadowRoot, "v", `export default { hello: "W" };`);

    // **ここが回帰の要**: 境界が無いと script が見えず「API セット待ち」に落ちて PENDING のまま
    //（SSR ではこのまま renderMutex ごとプロセスが止まっていた）
    expect(await settledWithin(volume.connectedCallbackPromise, 1500)).toBe("resolved");
    await flush();

    // script を見つけて import を試みたこと（＝ 無言の「ソース無し」待ちに落ちていないこと）。
    // このテスト環境（vitest + src 直読み）では blob: の動的 import を解決できないので
    // ロード自体は失敗する。**値が接ぎ木されるところまで**はビルド済みバンドルが走る
    // `packages/server/__tests__/render.test.ts` が固定する
    const reported = errors.mock.calls.map((c) => String(c[0]));
    expect(reported.some((m) => m.includes(`volume "v" failed to load`))).toBe(true);
    errors.mockRestore();
    host.remove();
  }, 20000);

  it("json= のボリューム（同期ソース）は従来どおり解決すること（対照）", async () => {
    const host = document.createElement(`vis-host-${++counter}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state json='{"root":1}'></wcs-state>` +
      `<wcs-state mount="v" json='{"hello":"J"}'></wcs-state>` +
      `<span id="t" data-wcs="textContent: v.hello"></span>`;
    document.body.appendChild(host);
    const volume = shadowRoot.querySelector("wcs-state[mount]") as State;
    expect(await settledWithin(volume.connectedCallbackPromise, 1200)).toBe("resolved");
    await State.getBindingsReady(shadowRoot);
    await flush();
    expect((shadowRoot.querySelector("#t") as HTMLElement).textContent).toBe("J");
    host.remove();
  }, 20000);
});
