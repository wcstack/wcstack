/**
 * binder は入っているが、state がまだ最初の構築を終えていない間に、本物の router（packages/router/dist）が
 * 着地する（#414）。state のスクリプトを router より先に読み、state のソースの読み込みに時間がかかるページの順。
 *
 * router が渡したルートの内容は構築の完了まで預けられ、構築の走査が行を描いた直後に、もう一度束ねられる。
 * そのとき行の中のノード（`if:` のアンカー）のループ文脈が消え、行の中の `if:` が次の切り替えで失敗していた。
 *
 * document に `<wcs-state>` を 1 つだけ置くページなので、このファイルのテストは 1 つにする
 * （document の「構築済み」は要素を外しても残り、2 つ目のテストの着地が構築の前に束ねてしまう）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { bootstrapRouter, settle } from "./helpers/binderRouterScenario";

beforeAll(() => {
  bootstrapState();
  bootstrapRouter();
});

describe("構築の前に router が着地したルートの、行の中の if:（#414）", () => {
  it("構築の後で束ね直されても、行の中の if: を切り替えられること", async () => {
    history.replaceState(null, "", "/");
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
    const rows = (): string[] => Array.from(document.querySelectorAll(".row"), (node) => node.textContent ?? "");
    try {
      document.body.innerHTML = `<wcs-router><template>
        <wcs-route path="/"><ul><template data-wcs="for: items"><li><template data-wcs="if: on"><b class="row">{{ .name }}</b></template></li></template></ul></wcs-route>
      </template></wcs-router><wcs-state></wcs-state>`;
      await settle();
      const stateElement = document.querySelector("wcs-state") as State;
      stateElement.setInitialState({ on: true, items: [{ name: "a" }, { name: "b" }] });
      await stateElement.connectedCallbackPromise;
      await settle();
      expect(rows()).toEqual(["a", "b"]);
      stateElement.createState("writable", (state) => { state.on = false; });
      await settle();
      expect(rows()).toEqual([]);
      stateElement.createState("writable", (state) => { state.on = true; });
      await settle();
      expect(rows()).toEqual(["a", "b"]);
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
      document.body.innerHTML = "";
    }
  });
});
