/**
 * proxy.apiAliases.test.ts — 依存 API の正式名（要件 B12・docs/state-3x-naming.ja.md V11 / V12）。
 * `$dependOn` / `$untracked` が `$trackDependency` / `$untrackDependency` と同じに働き、旧名も 3.x の間は
 * 動くこと、`**` の拒否が呼ばれた名前で報告されることを固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let counter = 0;

async function mountPage(state: Record<string, any>, body: string) {
  const host = document.createElement(`api-alias-host-${++counter}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${body}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(state);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  const write = async (fn: (s: any) => void) => { stateElement.createState("writable", fn); await flush(); };
  const text = (id: string) => shadowRoot.getElementById(id)!.textContent;
  return { host, write, text, stateElement };
}

describe("$dependOn / $untracked", () => {
  it.each(["$dependOn", "$trackDependency"])("%s は getter に明示の依存を足すこと", async (api) => {
    let evals = 0;
    const { host, write, text } = await mountPage(
      {
        key: "a",
        values: { a: 1, b: 2 },
        get picked(this: any) {
          evals++;
          this[api]("values");
          return this.$untracked(() => this.values[this.$untracked(() => this.key)]);
        },
      },
      `<span id="v" data-wcs="textContent: picked"></span>`,
    );
    expect(text("v")).toBe("1");
    const before = evals;
    await write((s) => { s.values = { a: 5, b: 6 }; });
    expect(text("v")).toBe("5");
    expect(evals).toBeGreaterThan(before);
    // key は $untracked の中で読んだので、key だけの変化では再評価されない
    const afterValues = evals;
    await write((s) => { s.key = "b"; });
    expect(evals).toBe(afterValues);
    host.remove();
  });

  it.each(["$untracked", "$untrackDependency"])("%s の中の読みは依存にならず、戻り値を返すこと", async (api) => {
    let evals = 0;
    const { host, write, text } = await mountPage(
      {
        a: 1,
        b: 10,
        get sum(this: any) {
          evals++;
          return this.a + this[api](() => this.b);
        },
      },
      `<span id="s" data-wcs="textContent: sum"></span>`,
    );
    expect(text("s")).toBe("11");
    const before = evals;
    await write((s) => { s.b = 20; });
    expect(evals).toBe(before);
    await write((s) => { s.a = 2; });
    expect(text("s")).toBe("22");
    host.remove();
  });

  it("`**` の拒否は呼ばれた名前で報告すること", async () => {
    const { host, stateElement } = await mountPage({ nodes: [] }, "");
    const messages: string[] = [];
    for (const api of ["$dependOn", "$trackDependency"]) {
      stateElement.createState("readonly", (s: any) => {
        try { s[api]("nodes.**.value"); } catch (error) { messages.push((error as Error).message); }
      });
    }
    expect(messages[0]).toContain('$dependOn("nodes.**.value") cannot take "**"');
    expect(messages[1]).toContain('$trackDependency("nodes.**.value") cannot take "**"');
    host.remove();
  });
});
