/**
 * #365: 同じオブジェクトをリストの 2 つの行に置くと、片方の行への葉の書き込みで、もう片方の行の
 * 表示と読みが古いまま残る（行の下のパスは行ごとにキャッシュされ、同じ要素を持つ別の行を引く手段が
 * 無い）。README に制約として書き、回避策として書いた後の `$postUpdate("<list>")` を案内する。
 * このテストは、今の制約（古いまま残る）と、回避策で揃うことの両方を固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r));
};

async function mount(body: string, postUpdate: boolean) {
  const o = { name: "a" };
  document.body.innerHTML = `<wcs-state></wcs-state>${body}`;
  const stateEl = document.querySelector("wcs-state") as State;
  stateEl.setInitialState({
    items: [o, o, { name: "c" }],
    get all(this: any) { return this.$getAll("items.*.name", []).join("/"); },
    rename(this: any) {
      this["items.0.name"] = "z";
      if (postUpdate) this.$postUpdate("items");
    },
  });
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(document);
  await settle();
  const run = async (fn: (s: any) => void) => {
    stateEl.createState("writable", fn);
    await settle();
  };
  const read = (path: string): unknown => {
    let value: unknown;
    stateEl.createState("readonly", (s: any) => { value = s[path]; });
    return value;
  };
  return { run, read };
}

const texts = (selector: string) => Array.from(document.querySelectorAll(selector)).map((n) => n.textContent);

describe("同じオブジェクトを 2 つの行に置いたときの葉の書き込み（#365・README の制約）", () => {
  it("書いた行でない方の行は古いまま残る（今の制約）", async () => {
    const { run, read } = await mount(`<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul><p>{{ all }}</p>`, false);
    await run((s) => s.rename());
    expect(texts("li")).toEqual(["z", "a", "c"]);
    expect(read("items.1.name")).toBe("a");
    expect(texts("p")).toEqual(["z/a/c"]);
  });

  it("書いた後に $postUpdate(\"items\") を呼ぶと、for で描く一覧・$getAll・添字の読みが揃う", async () => {
    const { run, read } = await mount(`<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul><p>{{ all }}</p>`, true);
    await run((s) => s.rename());
    expect(texts("li")).toEqual(["z", "z", "c"]);
    expect(read("items.1.name")).toBe("z");
    expect(texts("p")).toEqual(["z/z/c"]);
  });

  it("for で描いていない一覧でも、$postUpdate(\"items\") で添字の束縛と読みが揃う", async () => {
    const { run, read } = await mount(`<b>{{ items.0.name }}</b><i>{{ items.1.name }}</i><p>{{ all }}</p>`, true);
    await run((s) => s.rename());
    expect(texts("b")).toEqual(["z"]);
    expect(texts("i")).toEqual(["z"]);
    expect(read("items.1.name")).toBe("z");
    expect(texts("p")).toEqual(["z/z/c"]);
  });
});
