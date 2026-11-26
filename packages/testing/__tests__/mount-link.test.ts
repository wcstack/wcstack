import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mount } from "../src/exports";

const bootstrap = [
  async () => (await import("@wcstack/router")).bootstrapRouter(),
  async () => (await import("@wcstack/state")).bootstrapState(),
];

beforeAll(() => {
  history.replaceState(null, "", "/app/");
  const base = document.createElement("base");
  base.setAttribute("href", "/app/");
  document.head.appendChild(base);
});

afterAll(() => {
  document.head.querySelector("base")?.remove();
  history.replaceState(null, "", "/");
});

afterEach(() => {
  // (the anchors first: a link removes its own anchor on disconnect, which trips happy-dom's innerHTML setter)
  document.querySelectorAll("a").forEach((anchor) => anchor.remove());
  document.body.innerHTML = "";
});

/**
 * mount() はページを文書の外で組み立ててから入れる: 上の階層の節ごとに、子のそろった木が接続する — ブラウザの
 * パーサが、モジュールのスクリプトが upgrade する前に残すページと同じ。その場で埋めると happy-dom は開始タグの
 * 時点で接続を呼び、`<wcs-link>` は `<a>` へ移す文字を持たず、ルーターが basename を読む前に href を作った
 * （Advent Calendar の制作の記録、docs/v4-direction-2026-10.md §5.27）。
 */
describe("mount() と <wcs-link>", () => {
  it("ルーターの後ろのリンク: <a> にリンクの文字が移り、href に basename が付く", async () => {
    const html = `<wcs-state json='{"n":1}'></wcs-state>
      <wcs-router>
        <template>
          <wcs-route path="/"><h2>最初の画面</h2></wcs-route>
          <wcs-route path="/next"><h2>次の画面</h2></wcs-route>
        </template>
      </wcs-router>
      <wcs-outlet></wcs-outlet>
      <nav><wcs-link to="/">最初</wcs-link><wcs-link to="/next">次</wcs-link></nav>`;
    const app = await mount(html, { bootstrap });
    const anchors = [...app.root.querySelectorAll("nav wcs-link + a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(anchors).toEqual([["最初", "/app/"], ["次", "/app/next"]]);
    expect(app.root.querySelector("wcs-outlet h2")?.textContent).toBe("最初の画面");
  });
});
