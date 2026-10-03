import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, recursion } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([recursion]);
  bootstrapState();
});

const forest = () => [
  { value: 1, tags: [{ v: 3 }], children: [{ value: 10, tags: [{ v: 4 }], children: [] }] },
  { value: 2, tags: [{ v: 7 }], children: [] },
];

const ANCHOR = { "nodes.*": "children.*" };

/** A family getter `nodes.**.total` on `state` (descriptors copied: a spread would call the getter). */
const withTotal = (state: Record<string, any>) => Object.defineProperties(state, Object.getOwnPropertyDescriptors({
  get "nodes.**.total"() {
    const self = this as any;
    return self["nodes.**.value"] + self.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
  },
}));

/** An engine over `state` with the `nodes.*` / `children.*` anchor (descriptors kept). */
const make = (state: Record<string, any>) =>
  new Engine(Object.defineProperties({ $recursion: ANCHOR }, Object.getOwnPropertyDescriptors(state)), new DirtyStrategy());

async function host(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-recursion-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  return { root, el };
}

describe("$recursion の宣言", () => {
  it.each(["nodes..*", ".nodes.*"])("空の区切りを含む錨 %j を拒む", (anchor) => {
    expect(() => new Engine({ $recursion: { [anchor]: "children.*" } }, new DirtyStrategy())).toThrow("must not contain empty path segments.");
  });
});

describe("** の束縛と全深さの読み書き", () => {
  it("錨から始まらない ** のパスは [wcs/recursion-anchor]", () => {
    const e = make({ nodes: forest() });
    for (const path of ["other.**.x", "nodes.**x", "nodes.**.a.**"]) {
      expect(() => e.proxy.$getAll(path, [])).toThrow(`[wcs/recursion-anchor] "${path}" does not start at the recursion anchor "nodes.*".`);
    }
  });

  it("空の木・配列でない木はどの深さも無い（読みは空、一斉書き込みは 0 件）", () => {
    for (const nodes of [[], null]) {
      const e = make({ nodes });
      expect(e.proxy.$getAll("nodes.**.value", [])).toEqual([]);
      expect(e.proxy.$setAll("nodes.**.selected", [], true)).toBe(0);
    }
  });

  it("** の無い $setAll はそのまま通す", () => {
    const e = make({ nodes: forest() });
    expect(e.proxy.$setAll("nodes.*.value", [], 0)).toBe(2);
    expect(e.proxy.$getAll("nodes.**.value", [])).toEqual([0, 10, 0]);
  });

  it("$resolve は ** を受け付けない（族の雛形の getter も [wcs/recursion-unsupported]）", () => {
    const e = make(withTotal({ nodes: forest() }));
    expect(() => e.proxy.$resolve("nodes.**.total", [])).toThrow('[wcs/recursion-unsupported] #1101 "nodes.**.total"');
    // the expansions are ordinary getters
    expect(e.proxy.$resolve("nodes.*.total", [0])).toBe(11);
  });
});

describe("<wcs-state> の中の **", () => {
  it("入れ子の別のリストの行のイベントでも、その行が属するノードの深さに束ねる", async () => {
    const seen: number[] = [];
    const { root } = await host(
      `<ul><template data-wcs="for: nodes"><li><template data-wcs="for: .tags"><i data-wcs="onclick: pick">{{ .v }}</i></template></li></template></ul>`,
      { nodes: forest(), $recursion: ANCHOR, pick(this: any) { seen.push(this["nodes.**.value"]); } },
    );
    const tags = root.querySelectorAll("i");
    expect(Array.from(tags).map((t) => t.textContent)).toEqual(["3", "7"]);
    (tags[1] as HTMLElement).click();
    (tags[0] as HTMLElement).click();
    expect(seen).toEqual([2, 1]);
  });

  it("$resolve の ** は [wcs/recursion-unsupported]（描いた後も）", async () => {
    const { el } = await host(`<p>{{ nodes.length }}</p>`, { nodes: forest(), $recursion: ANCHOR });
    expect(() => el.createState("readonly", (s: any) => s.$resolve("nodes.**.value", [0]))).toThrow('[wcs/recursion-unsupported] #1101 "nodes.**.value"');
  });

  it("読み取り専用の状態からの ** の一斉書き込みは拒む", async () => {
    const { el } = await host(``, { nodes: forest(), $recursion: ANCHOR });
    expect(() => el.createState("readonly", (s: any) => s.$setAll("nodes.**.selected", [], true))).toThrow("This state is readonly.");
    let all: unknown;
    el.createState("readonly", (s: any) => { all = s.$getAll("nodes.**.selected", []); });
    expect(all).toEqual([undefined, undefined, undefined]);
  });

  it("$recursion の無い状態への再セットで ** は使えなくなり、ほかの API はそのまま動く", async () => {
    const { root, el } = await host(`<ul><template data-wcs="for: nodes"><li>{{ .value }}</li></template></ul>`, { nodes: forest(), $recursion: ANCHOR });
    let before: unknown;
    el.createState("readonly", (s: any) => { before = s.$getAll("nodes.**.value", []); });
    expect(before).toEqual([1, 10, 2]);
    el.setInitialState({ nodes: forest() });
    await flush();
    expect(() => el.createState("readonly", (s: any) => s.$getAll("nodes.**.value", []))).toThrow("[wcs/recursion-unsupported]");
    let written: unknown;
    el.createState("writable", (s: any) => { written = s.$setAll("nodes.*.value", [], 5); });
    await flush();
    expect(written).toBe(2);
    expect(Array.from(root.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["5", "5"]);
  });
});
