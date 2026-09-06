import { describe, it, expect, afterEach } from "vitest";
import { mount, settle } from "../src/exports";

afterEach(() => {
  document.body.innerHTML = "";
});

const ROUTES = `
  <wcs-router>
    <template>
      <wcs-route path="/"><p id="home">home</p></wcs-route>
      <wcs-route fallback><p id="nf">not found</p></wcs-route>
    </template>
  </wcs-router>
  <wcs-outlet></wcs-outlet>
`;
const bootstrapRouter = async () => (await import("@wcstack/router")).bootstrapRouter();
const bootstrapState = async () => (await import("@wcstack/state")).bootstrapState();

/**
 * 受け入れ条件（docs/app-testing-and-typescript-impl-plan.md §6）: `<wcs-router>` を
 * 含む HTML を mount し、初回ルートの描画結果を待った後に assert できる。
 * router は `static hasConnectedCallbackPromise` の readiness プロトコルに乗るので、
 * server の waitForReady が state と同じ 1 呼び出しで待つ。
 */
describe("mount + @wcstack/router", () => {
  it("router だけのページ: 初回ルートの適用を待ってから outlet の中身を assert できる", async () => {
    const app = await mount(ROUTES, { bootstrap: [bootstrapRouter] });
    expect(app.root.querySelector("#home")).not.toBeNull();
    expect(app.root.querySelector("#nf")).toBeNull();
  }, 10_000);

  it("router + state のページ: ルート内容のバインドまで待つ", async () => {
    const app = await mount(`<wcs-state json='{"who": "world"}'></wcs-state>${ROUTES.replace(
      '<p id="home">home</p>',
      '<p id="home" data-wcs="textContent: who"></p>',
    )}`, { bootstrap: [bootstrapRouter, bootstrapState] });
    const immediate = app.root.querySelector("#home")!.textContent;
    await settle();
    const afterSettle = app.root.querySelector("#home")!.textContent;
    expect({ immediate, afterSettle }).toEqual({ immediate: "world", afterSettle: "world" });
  }, 10_000);
});
