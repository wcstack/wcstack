/**
 * router が先に着地し、state が後から構築する順で、本物の router（packages/router/dist）から binder を通す。
 * binder は入っているので、構築の前に router と `<wcs-head>` が渡したものは、構築の完了まで預けられる。
 * #409 の修正がこの順を壊していないことを確かめる守りのテストで、修正前（3.5.0）でも通る（回帰テストでは
 * ない）。同じ順で行の中の `if:` を確かめる #414 の回帰テストは integration.binder.rowContextLanding.test.ts。
 *
 * - 着地のルートの内容は state の最初の走査が束ね、router が binder へもう一度渡しても二重に
 *   束ねない（1 回のクリックで 1 回）。
 * - `<wcs-head>` は構築の前に `<title data-wcs>`（宣言を根に持つ）を渡すので、binder は構築の
 *   完了まで預かってから束ねる（drainPendingBinds）。根の宣言は束ね続ける。
 *
 * document に `<wcs-state>` を 1 つだけ置くページなので、このファイルのテストは 1 つにする
 * （document の「構築済み」は要素を外しても残り、2 つ目のテストの着地が構築の前に束ねてしまう）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { ROUTER_PAGE, bootstrapRouter, initialState, runRouterScenario, settle } from "./helpers/binderRouterScenario";

beforeAll(() => {
  bootstrapState();
  bootstrapRouter();
});

describe("router が先に着地し、state が後から構築する（守り。修正前も通る）", () => {
  it("着地のルートの for: / if: と <wcs-head> の title が描かれ、出入りしても 1 回のクリックで 1 回だけ数えること", async () => {
    const result = await runRouterScenario(async () => {
      history.replaceState(null, "", "/v");
      document.body.innerHTML = `${ROUTER_PAGE(false)}<wcs-state></wcs-state>`;
      await settle();
      const stateElement = document.querySelector("wcs-state") as State;
      stateElement.setInitialState(initialState());
      await stateElement.connectedCallbackPromise;
      await settle();
      return stateElement;
    }, "/v");
    expect(result.errors).toEqual([]);
    expect(result.seen).toEqual([
      "msg=[hi] li=[a/b] on=[on] title=[hi]",
      "msg=[hi] li=[a/b] on=[on] title=[hi]",
      "msg=[bye] li=[c] on=[] title=[bye]",
    ]);
    expect(result.counts).toEqual([1, 2]);
  });
});
