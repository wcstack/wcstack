/**
 * `$resolve` の**添字の省略**が chroot ごとに違うことを、実測どおりに固定する
 * （docs/state-mount-design.md §4-6 の表）。
 *
 * | chroot | `$resolve("x")` | `$resolve("x", null)` | `$resolve("x", [])` |
 * |---|---|---|---|
 * | ルート | raise（要件 B7） | raise | ok |
 * | ボリューム（`mount=`） | raise | raise | ok |
 * | コンポーネント（`this` / `element.state`） | **ok** | **ok** | ok |
 *
 * コンポーネントだけ緩いのは意図（`overlay.ts` の `indexes ?? []`）: スコープ側は
 * `composeMountIndexes` がホスト行の添字を前置できる ＝ 文脈を知っている。
 * 3.x では変えない（拒否に揃えるのは「今まで通っていたものを落とす」方向）。
 * 4.0 でルートに揃えるなら、このファイルの期待値が変更点の一覧になる。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r));
let counter = 0;

/** 呼び出しの結果を "ok" / "raise" に畳む（添字の形の診断だけを見る） */
function outcome(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (error) {
    return String((error as Error).message).includes("requires an explicit indexes array") ? "raise" : "other";
  }
}

describe("$resolve の添字省略（chroot ごとの契約）", () => {
  it("ルートとボリュームは省略と null を拒否し、[] だけを受けること", async () => {
    const host = document.createElement(`ric-vol-${++counter}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state json='{"a":1}'></wcs-state><wcs-state mount="v"></wcs-state>`;
    document.body.appendChild(host);
    const volumeOutcomes: string[] = [];
    const volume = shadowRoot.querySelector("wcs-state[mount]") as State;
    volume.setInitialState({
      x: 5,
      $connectedCallback(this: any) {
        volumeOutcomes.push(
          outcome(() => this.$resolve("x")),
          outcome(() => this.$resolve("x", null)),
          outcome(() => this.$resolve("x", [])),
        );
      },
    });
    const root = shadowRoot.querySelector("wcs-state:not([mount])") as State;
    await root.connectedCallbackPromise;
    await volume.connectedCallbackPromise;
    await flush();

    expect(volumeOutcomes).toEqual(["raise", "raise", "ok"]);

    const rootOutcomes: string[] = [];
    root.createState("readonly", (state: any) => {
      rootOutcomes.push(
        outcome(() => state.$resolve("a")),
        outcome(() => state.$resolve("a", null)),
        outcome(() => state.$resolve("a", [])),
      );
    });
    expect(rootOutcomes).toEqual(["raise", "raise", "ok"]);
    host.remove();
  }, 20000);

  it("マウントされたコンポーネントの 2 つの chroot は省略と null を空列に倒すこと（意図・3.x では不変）", async () => {
    const tag = `ric-comp-${++counter}`;
    const overlayOutcomes: string[] = [];
    class Comp extends HTMLElement {
      state: Record<string, any> = {
        probe(this: any) {
          overlayOutcomes.push(
            outcome(() => this.$resolve("name")),
            outcome(() => this.$resolve("name", null)),
            outcome(() => this.$resolve("name", [])),
          );
        },
      };
      constructor() { super(); this.attachShadow({ mode: "open" }); }
      connectedCallback() {
        if (this.shadowRoot!.childNodes.length === 0) {
          this.shadowRoot!.innerHTML = `<wcs-state bind-component="state"></wcs-state>`;
        }
      }
    }
    customElements.define(tag, Comp);
    const host = document.createElement(`ric-host-${counter}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state json='{"user":{"name":"A"}}'></wcs-state><${tag} data-wcs="state: user"></${tag}>`;
    document.body.appendChild(host);
    await (shadowRoot.querySelector("wcs-state") as State).connectedCallbackPromise;
    const component = shadowRoot.querySelector(tag) as HTMLElement & { state: any };
    await (component.shadowRoot!.querySelector("wcs-state") as State).connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();

    component.state.probe();
    expect(overlayOutcomes).toEqual(["ok", "ok", "ok"]);
    expect([
      outcome(() => component.state.$resolve("name")),
      outcome(() => component.state.$resolve("name", null)),
      outcome(() => component.state.$resolve("name", [])),
    ]).toEqual(["ok", "ok", "ok"]);
    host.remove();
  }, 20000);
});
