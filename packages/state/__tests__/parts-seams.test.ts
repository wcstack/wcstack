/**
 * parts-seams.test.ts — 部品で組み立てるページの継ぎ目（docs/seam-apps.md、garden-plots）。
 * 丸ごとマウントした部品・入れ子の部品・DCC・ボリュームで、ページとの間に起きた欠陥と沈黙:
 * - まだ届いていないボリュームの下へ、要素が束ねた時点で書く（ルートが落ちていた）
 * - ボリュームがルートより先に届いたときの接ぎ木を「新しいキー」と言う誤報
 * - `#ro` の 1 つのキーが、中に入れ子にした部品には効かない
 * - DCC に最初に渡した値を `$connectedCallback` が見ない
 * - 部品の中のパスの誤り（ページ側の `state.veiw:`、部品側の `veiw.x`、`nmae`、ページのパス）が無言
 * - 部品がツリーに書くと「新しいキー」と言う誤報、部品が届く前の公開 getter を「無い」と言う誤報
 * - サーバーが部品のクラスを知らずに描いた行（ハイドレーション）
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, diagnostics, getBindingsReady, installFeatures, scopes, ssr, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([scopes, ssr, temporal, diagnostics]);
  bootstrapState();
});

/** A class part: its template in a shadow root, its own state `own`. */
function part(markup: string, own: () => Record<string, any> = () => ({}), tag = `seam-part-${seq++}`): string {
  customElements.define(tag, class extends HTMLElement {
    state = own();
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML = `<wcs-state bind-component="state"></wcs-state>${markup}`;
    }
  });
  return tag;
}

/** A page (a shadow root) whose root `<wcs-state>` gets `state`; the other `<wcs-state>` elements are left to the test. */
async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`seam-page-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state:not([mount])") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise.catch(() => {});
  for (let i = 0; i < 3; i++) await flush();
  const read = (path: string) => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    for (let i = 0; i < 2; i++) await flush();
  };
  return { h, root, el, read, write };
}

/** Runs `fn` with console.warn / console.error and uncaught reports collected. */
async function heard<T>(fn: () => Promise<T>): Promise<{ result: T; warns: string[]; errors: string[] }> {
  const warns: string[] = [];
  const errors: string[] = [];
  const w = vi.spyOn(console, "warn").mockImplementation((...a) => { warns.push(a.map(String).join(" ")); });
  const e = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.map(String).join(" ")); });
  const onError = (ev: ErrorEvent) => { errors.push(String(ev.error?.message ?? ev.message)); ev.preventDefault(); };
  window.addEventListener("error", onError);
  try {
    const result = await fn();
    for (let i = 0; i < 3; i++) await flush();
    return { result, warns, errors };
  } finally {
    window.removeEventListener("error", onError);
    w.mockRestore();
    e.mockRestore();
  }
}

/** A wc-bindable element that holds a value when it is bound (as `<wcs-storage>` does). */
function store(value: unknown): string {
  const tag = `seam-store-${seq++}`;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable", version: 1,
      properties: [{ name: "value", event: `${tag}:value-changed` }],
      inputs: [{ name: "value" }],
    };
    value: unknown = value;
    say(next: unknown): void {
      this.value = next;
      this.dispatchEvent(new CustomEvent(`${tag}:value-changed`, { detail: next, bubbles: true }));
    }
  });
  return tag;
}

describe("まだ届いていないボリュームの下へ、要素が書く", () => {
  it("束ねた時点で要素が持っていた値は、ボリュームが接ぎ木されたときに着く（ルートは落ちない）", async () => {
    const tag = store({ theme: "dark" });
    const { result: p, errors } = await heard(() => page(
      `<wcs-state></wcs-state><wcs-state mount="settings"></wcs-state>`
      + `<${tag} data-wcs="value#init=element: settings.stored"></${tag}><p id="t">{{ title }}</p><p id="s">{{ settings.stored.theme }}|{{ settings.theme }}</p>`,
      { title: "root" },
    ));
    // the page is bound without the volume: nothing failed
    expect(errors).toEqual([]);
    expect(p.root.querySelector("#t")!.textContent).toBe("root");
    // the element writes again before the volume is there: the last one wins
    (p.root.querySelector(tag) as any).say({ theme: "sepia" });
    await flush();
    const volume = p.root.querySelector("wcs-state[mount]") as any;
    volume.setInitialState({ theme: "light", stored: null });
    await volume.connectedCallbackPromise;
    for (let i = 0; i < 2; i++) await flush();
    expect(p.read("settings.stored")).toEqual({ theme: "sepia" });
    expect(p.root.querySelector("#s")!.textContent).toBe("sepia|light");
    // and from then on a write lands at once
    (p.root.querySelector(tag) as any).say({ theme: "mono" });
    await flush();
    expect(p.read("settings.stored")).toEqual({ theme: "mono" });
  });

  it("接ぎ木されなかったボリュームは理由を言い、預かった書き込みは捨てる", async () => {
    const tag = store("x");
    const { result: p, errors } = await heard(async () => {
      const q = await page(
        `<wcs-state></wcs-state><wcs-state mount="taken"></wcs-state><${tag} data-wcs="value#init=element: taken.v"></${tag}>`,
        { taken: null },
      );
      const volume = q.root.querySelector("wcs-state[mount]") as any;
      volume.setInitialState({ v: 0, $watch: {} });
      await volume.connectedCallbackPromise;
      return q;
    });
    expect(errors.some((e) => e.includes(`<wcs-state mount="taken"> $watch is not run in a volume`))).toBe(true);
    expect(p.read("taken")).toBe(null);
  });

  it("コードの書き込みは預からない（今までどおり、無いパスへの書き込みは失敗する）", async () => {
    const p = await page(`<wcs-state></wcs-state><wcs-state mount="late"></wcs-state>`, { title: "root" });
    let thrown = "";
    try {
      p.el.createState("writable", (s: any) => { s["late.x"] = 1; });
    } catch (e) {
      thrown = String((e as Error).message);
    }
    expect(thrown).toContain(`"late"`);
  });
});

describe("ボリュームの接ぎ木は書き込みの誤りではない", () => {
  it("ルートより先に届いたボリュームのマウントパスが宣言済みのキーに近くても、write-path-missing を言わない", async () => {
    const h = document.createElement(`seam-page-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    // the volumes first, the root's state later
    root.innerHTML = `<wcs-state mount="faq"></wcs-state><wcs-state mount="map"></wcs-state><wcs-state></wcs-state><p>{{ map.filter }}|{{ faq.open }}</p>`;
    const [faq, map, rootEl] = Array.from(root.querySelectorAll("wcs-state")) as any[];
    const { warns } = await heard(async () => {
      faq.setInitialState({ open: false });
      map.setInitialState({ filter: "all" });
      document.body.appendChild(h);
      await flush();
      rootEl.setInitialState({ title: "root" });
      await rootEl.connectedCallbackPromise;
      await getBindingsReady(root);
    });
    expect(root.querySelector("p")!.textContent).toBe("all|false");
    expect(warns.filter((w) => w.includes("write-path-missing"))).toEqual([]);
  });

  it("本当の書き間違い（宣言済みのキーに近い新しいキー）は今までどおり言う", async () => {
    const { warns } = await heard(async () => {
      const p = await page(`<wcs-state></wcs-state><p>{{ selectedId }}</p>`, { selectedId: 1 });
      await p.write((s) => { s.selectedID = 2; });
    });
    expect(warns.filter((w) => w.includes("write-path-missing") && w.includes(`"selectedID"`)).length).toBe(1);
  });
});

describe("部品がツリーに書く", () => {
  it("丸ごとマウントした部品が渡されたキーに書いても、自分の名前に近いからといって「新しいキー」とは言わない", async () => {
    const card = part(`<span>{{ name }}</span><button data-wcs="onclick: rename">go</button>`, () => ({ rename(this: any) { this.name = "Z"; } }));
    const { result: p, warns } = await heard(async () => {
      const q = await page(`<wcs-state></wcs-state><${card} data-wcs="state: user"></${card}><p>{{ user.name }}</p>`, { user: { name: "Alice" } });
      (q.root.querySelector(card)!.shadowRoot!.querySelector("button") as HTMLElement).click();
      return q;
    });
    expect(p.root.querySelector("p")!.textContent).toBe("Z");
    expect(warns.filter((w) => w.includes("write-path-missing"))).toEqual([]);
  });
});

describe("#ro と、中に入れ子にした部品", () => {
  const nested = (outer: string, inner: string) => {
    const tile = part(`<button class="no" data-wcs="onclick: rename; textContent: no"></button><button class="sel" data-wcs="onclick: select">s</button><input data-wcs="value: view.note">`, () => ({
      rename(this: any) { this.no = `${this.no}!`; },
      select(this: any) { this["view.selectedId"] = this.id; },
    }));
    const card = part(`<template data-wcs="for: plots"><${tile} data-wcs="state${inner}: .; state.view${inner}: view"></${tile}></template>`);
    const html = `<wcs-state></wcs-state><${card} data-wcs="state${outer}: garden; state.view${outer}: view"></${card}>`;
    const state = { garden: { plots: [{ id: 1, no: "A-01" }] }, view: { selectedId: null, note: "" } };
    return { tile, card, html, state };
  };
  const firstTile = (root: ShadowRoot, card: string, tile: string) => root.querySelector(card)!.shadowRoot!.querySelector(tile)!.shadowRoot!;

  it("1 つのキーだけを #ro で渡された部品の中の部品も、そのキーに書けない", async () => {
    const { tile, card, html, state } = nested("#ro", "");
    const { result: p, errors } = await heard(async () => {
      const q = await page(html, state);
      (firstTile(q.root, card, tile).querySelector(".sel") as HTMLElement).click();
      await flush();
      (firstTile(q.root, card, tile).querySelector(".no") as HTMLElement).click();
      return q;
    });
    expect(p.read("view.selectedId")).toBe(null);
    expect(p.read("garden.plots.0.no")).toBe("A-01");
    expect(errors.some((e) => e.includes(`[wcs/mount-readonly] <${card}> cannot write "view.selectedId": it is mounted read-only ("state.view#ro: view")`))).toBe(true);
    expect(errors.some((e) => e.includes(`[wcs/mount-readonly] <${card}> cannot write "plots.*.no"`))).toBe(true);
  });

  it("中の部品の双方向の入力は、書き戻さない（#ro の束縛と同じ）", async () => {
    const { tile, card, html, state } = nested("#ro", "");
    const { result: p, errors } = await heard(async () => {
      const q = await page(html, state);
      const input = firstTile(q.root, card, tile).querySelector("input") as HTMLInputElement;
      input.value = "typed";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return q;
    });
    expect(p.read("view.note")).toBe("");
    expect(errors).toEqual([]);
  });

  it("#ro でなければ、中の部品の書き込みはページに届く", async () => {
    const { tile, card, html, state } = nested("", "");
    const p = await page(html, state);
    (firstTile(p.root, card, tile).querySelector(".sel") as HTMLElement).click();
    (firstTile(p.root, card, tile).querySelector(".no") as HTMLElement).click();
    await flush();
    expect(p.read("view.selectedId")).toBe(1);
    expect(p.read("garden.plots.0.no")).toBe("A-01!");
  });
});

describe("DCC に最初に渡した値", () => {
  it("インスタンスの状態ができる前にページが書いた値を、$connectedCallback が見る", async () => {
    const tag = `seam-dcc-${seq++}`;
    const def = document.createElement(tag);
    def.setAttribute("data-wc-definition", "");
    const shadow = def.attachShadow({ mode: "open" });
    shadow.innerHTML = `<p>{{ seen }}|{{ total }}</p><wcs-state></wcs-state>`;
    const state = () => ({
      total: 0, seen: "-", watched: [] as number[],
      $bindables: ["total"],
      $connectedCallback(this: any) { this.seen = `cc:${this.total}`; },
      $watch: { total(this: any, v: number) { this.watched.push(v); } },
    });
    (shadow.querySelector("wcs-state") as any).setInitialState(state());
    document.body.appendChild(def);
    await (shadow.querySelector("wcs-state") as any).connectedCallbackPromise;

    const el = document.createElement(tag) as any;
    document.body.appendChild(el);
    el.total = 120; // before its state is there
    const inner = el.stateElement;
    inner.setInitialState(state());
    await inner.connectedCallbackPromise;
    for (let i = 0; i < 2; i++) await flush();
    expect(el.shadowRoot.querySelector("p").textContent).toBe("cc:120|120");
    // a later write is an ordinary one: the watch hears it
    el.total = 160;
    for (let i = 0; i < 2; i++) await flush();
    expect(el.watched).toEqual([160]);
  });

  it("属性で書いた入力は読まれない: タグと名前ごとに 1 度言う", async () => {
    const tag = `seam-dcc-${seq++}`;
    const def = document.createElement(tag);
    def.setAttribute("data-wc-definition", "");
    const shadow = def.attachShadow({ mode: "open" });
    shadow.innerHTML = `<p>{{ total }}</p><wcs-state></wcs-state>`;
    const state = () => ({ total: 0, per: 20, $bindables: ["total", "per"] });
    (shadow.querySelector("wcs-state") as any).setInitialState(state());
    document.body.appendChild(def);
    await (shadow.querySelector("wcs-state") as any).connectedCallbackPromise;
    const { warns } = await heard(async () => {
      for (let i = 0; i < 2; i++) {
        const el = document.createElement(tag) as any;
        el.setAttribute("total", "120");
        el.setAttribute("title", "not an input");
        document.body.appendChild(el);
        el.stateElement.setInitialState(state());
        await el.stateElement.connectedCallbackPromise;
      }
    });
    expect(warns.filter((w) => w.includes("[wcs/dcc-attribute]"))).toEqual([
      `[@wcstack/state] [wcs/dcc-attribute] <${tag} total="…">: a DCC does not read attributes. Bind it (data-wcs="total: path") or set the property.`,
    ]);
  });
});

describe("ページと部品の継ぎ目の名前の誤り", () => {
  const rows = (card: string, wiring: string) => `<wcs-state></wcs-state><template data-wcs="for: users"><${card} data-wcs="${wiring}"></${card}></template>`;
  const state = () => ({ users: [{ name: "Alice" }, { name: "Bob" }], view: { theme: "dark" }, pageTitle: "people" });
  const said = (warns: string[]) => warns.filter((w) => w.includes("-path-missing"));

  it("ページ側の名前の誤り（state.veiw:）: 部品が読む view が無いと言い、渡された名前を挙げる", async () => {
    // (the template binds it and a getter reads it: one mistake, told once)
    const card = part(`<span>{{ name }}</span><span>{{ view.theme }}</span><span>{{ dark }}</span>`, () => ({
      get dark() { return (this as any)["view.theme"] === "dark"; },
    }));
    const { warns } = await heard(() => page(rows(card, "state: .; state.veiw: view"), state()));
    const w = said(warns);
    expect(w.length).toBe(1);
    expect(w[0]).toContain(`[wcs/binding-path-missing] Bound path "view.theme" in <${card}> — its host's "users.*.view.theme" — does not resolve on the state tree: "view" is not declared. Did you mean "veiw"?`);
    expect(w[0]).toContain(`"view" is a path of the host: hand it over (data-wcs="state.view: view").`);
    expect(w[0]).not.toContain("npx @wcstack/lint");
  });

  it("部品側の名前の誤り（veiw.theme）: 渡された名前 view を挙げる", async () => {
    const card = part(`<span>{{ name }}</span><span>{{ veiw.theme }}</span>`);
    const { warns } = await heard(() => page(rows(card, "state: .; state.view: view"), state()));
    const w = said(warns);
    expect(w.length).toBe(1);
    expect(w[0]).toContain(`Bound path "veiw.theme" in <${card}> — its host's "users.*.veiw.theme" — does not resolve on the state tree: "veiw" is not declared. Did you mean "view"? Updates to this path will be silently dropped.`);
  });

  it("部品のテンプレートの打ち間違い（nmae）: 行が持つ名前を挙げる。部品が何枚あっても 1 度", async () => {
    const card = part(`<span>{{ nmae }}</span>`);
    const { warns } = await heard(() => page(rows(card, "state: ."), state()));
    const w = said(warns);
    expect(w.length).toBe(1);
    expect(w[0]).toContain(`Bound path "nmae" in <${card}> — its host's "users.*.nmae" — does not resolve on the state tree: "nmae" is not declared. Did you mean "name"?`);
  });

  it("部品の中で読んだページのパス: 近い名前が無くても言う", async () => {
    const card = part(`<span>{{ name }}</span><span>{{ pageTitle }}</span>`);
    const { warns } = await heard(() => page(rows(card, "state: ."), state()));
    const w = said(warns);
    expect(w.length).toBe(1);
    expect(w[0]).toContain(`"pageTitle" is a path of the host: hand it over (data-wcs="state.pageTitle: pageTitle").`);
  });

  it("行に無い項目で、近い名前も無く、ページのパスでもないものは言わない（行の項目は省かれることがある）", async () => {
    const card = part(`<span>{{ name }}</span><span>{{ memo }}</span>`);
    const { warns } = await heard(() => page(rows(card, "state: ."), state()));
    expect(said(warns)).toEqual([]);
  });

  it("部品が、渡されたリストの行に自分で宣言した getter は言わない", async () => {
    const card = part(`<template data-wcs="for: tags"><b data-wcs="textContent: .shout"></b></template>`, () => ({
      get "tags.*.shout"() { return String((this as any)["tags.*.label"]).toUpperCase(); },
    }));
    const { result: p, warns } = await heard(() => page(
      `<wcs-state></wcs-state><${card} data-wcs="state: user"></${card}>`,
      { user: { name: "Alice", tags: [{ label: "a" }, { label: "b" }] } },
    ));
    expect(said(warns)).toEqual([]);
    expect(p.root.querySelector(card)!.shadowRoot!.textContent).toBe("AB");
  });

  it("先頭のキーより深い所の無い項目は言わない（部品の中の木は、部品が答えることがある）", async () => {
    const card = part(`<span>{{ address.cty }}</span>`);
    const { warns } = await heard(() => page(
      `<wcs-state></wcs-state><${card} data-wcs="state: user"></${card}>`,
      { user: { name: "Alice", address: { city: "A" } } },
    ));
    expect(said(warns)).toEqual([]);
  });

  it("行でないマウント（state: user）では、無いキーをそのまま言う", async () => {
    const card = part(`<span>{{ name }}</span><span>{{ note }}</span>`);
    const { warns } = await heard(() => page(`<wcs-state></wcs-state><${card} data-wcs="state: user"></${card}>`, { user: { name: "Alice" } }));
    const w = said(warns);
    expect(w.length).toBe(1);
    expect(w[0]).toContain(`Bound path "note" in <${card}> — its host's "user.note" — does not resolve on the state tree: "note" is not declared.`);
  });

  it("部品の getter が読む名前の誤りも言う（部品の最上位のキーも）", async () => {
    const card = part(`<span>{{ label }}</span><span>{{ locked }}</span>`, () => ({
      get label() { return `${(this as any).nmae}`; },
      get locked() { return !(this as any)["veiw.selectable"]; },
    }));
    const { warns } = await heard(() => page(rows(card, "state: .; state.view: view"), state()));
    const w = said(warns);
    expect(w.some((x) => x.includes(`[wcs/read-path-missing] Path "nmae" in <${card}> — its host's "users.*.nmae" — does not resolve on the state tree: "nmae" is not declared. Did you mean "name"? The getter reads undefined.`))).toBe(true);
    expect(w.some((x) => x.includes(`[wcs/read-path-missing] Path "veiw.selectable" in <${card}>`) && x.includes(`Did you mean "view"?`))).toBe(true);
    expect(w.length).toBe(2);
  });

  it("部品の中の部品の誤りは、木のあるページまでたどって言う", async () => {
    const tile = part(`<span>{{ no }}</span><span>{{ veiw.selectable }}</span>`);
    const card = part(`<template data-wcs="for: plots"><${tile} data-wcs="state: .; state.view: view"></${tile}></template>`);
    const { warns } = await heard(() => page(
      `<wcs-state></wcs-state><template data-wcs="for: gardens"><${card} data-wcs="state: .; state.view: view"></${card}></template>`,
      { gardens: [{ plots: [{ no: "A-01" }] }], view: { selectable: true } },
    ));
    const w = said(warns);
    expect(w.length).toBe(1);
    expect(w[0]).toContain(`Bound path "veiw.selectable" in <${tile}> — its host's "gardens.*.plots.*.veiw.selectable" — does not resolve on the state tree: "veiw" is not declared. Did you mean "view"?`);
  });

  it("正しい部品は何も言わない（渡されたキー、自分のキー、自分の getter）", async () => {
    const card = part(`<span>{{ name }}</span><span>{{ view.theme }}</span><span>{{ open }}</span><span>{{ label }}</span>`, () => ({
      open: false,
      get label() { return `${(this as any).name}/${(this as any)["view.theme"]}`; },
    }));
    const { result: p, warns } = await heard(() => page(rows(card, "state: .; state.view: view"), state()));
    expect(said(warns)).toEqual([]);
    expect(p.root.querySelector(card)!.shadowRoot!.textContent).toBe("Alicedarkfalse" + "Alice/dark");
  });
});

describe("部品が公開する getter を、部品が届く前にページが読む", () => {
  it("部品が定義されるまで「無い」とは言わず、定義されたら読める", async () => {
    const tag = `seam-late-${seq++}`;
    const { result: p, warns } = await heard(async () => {
      const q = await page(`<wcs-state></wcs-state><${tag} data-wcs="state: g"></${tag}><p>{{ g.freeCount }}</p>`, { g: { name: "G1" } });
      for (let i = 0; i < 3; i++) await flush();
      expect(q.root.querySelector("p")!.textContent).toBe("");
      part(`<span>{{ name }}</span>`, () => ({ get freeCount() { return 14; } }), tag);
      for (let i = 0; i < 4; i++) await flush();
      return q;
    });
    expect(p.root.querySelector("p")!.textContent).toBe("14");
    expect(warns.filter((w) => w.includes("-path-missing"))).toEqual([]);
  });

  it("定義されても公開されない名前は、そのとき言う", async () => {
    const tag = `seam-late-${seq++}`;
    const { warns } = await heard(async () => {
      await page(`<wcs-state></wcs-state><${tag} data-wcs="state: g"></${tag}><p>{{ g.freeCuont }}</p>`, { g: { name: "G1" } });
      for (let i = 0; i < 3; i++) await flush();
      part(`<span>{{ name }}</span>`, () => ({ get freeCount() { return 14; } }), tag);
      for (let i = 0; i < 4; i++) await flush();
    });
    expect(warns.filter((w) => w.includes("binding-path-missing") && w.includes(`"g.freeCuont"`)).length).toBe(1);
  });

  it("ついに定義されない部品の下のパスは、未定義の要素を言うのと同じ時に言う", async () => {
    vi.useFakeTimers();
    try {
      const tag = `seam-never-${seq++}`;
      const warns: string[] = [];
      const spy = vi.spyOn(console, "warn").mockImplementation((...a) => { warns.push(a.map(String).join(" ")); });
      const h = document.createElement(`seam-page-${seq++}`);
      const root = h.attachShadow({ mode: "open" });
      root.innerHTML = `<wcs-state></wcs-state><${tag} data-wcs="state: g"></${tag}><p>{{ g.freeCount }}</p><i data-wcs="textContent: g.title|upper"></i>`;
      (root.querySelector("wcs-state") as any).setInitialState({ g: { name: "G1" } });
      document.body.appendChild(h);
      await vi.advanceTimersByTimeAsync(50);
      expect(warns.filter((w) => w.includes("binding-path-missing"))).toEqual([]);
      await vi.advanceTimersByTimeAsync(5100);
      expect(warns.filter((w) => w.includes("binding-path-missing") && w.includes(`"g.freeCount"`)).length).toBe(1);
      spy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("1 つの部品に <wcs-state bind-component> が 2 つ", () => {
  it("ホストの配線を待つ間に 2 つ目が来ても、どちらも決着する（2 つ目は断られる）", async () => {
    const tag = part(`<wcs-state bind-component="state"></wcs-state><span>{{ name }}</span>`);
    const h = document.createElement(`seam-page-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state><${tag} data-wcs="state: user"></${tag}>`;
    const { errors } = await heard(async () => {
      document.body.appendChild(h);
      await flush();
      // the page's state arrives after the part loaded: both state elements were waiting for the wiring
      (root.querySelector("wcs-state") as any).setInitialState({ user: { name: "Alice" } });
      const states = Array.from(root.querySelector(tag)!.shadowRoot!.querySelectorAll("wcs-state")) as any[];
      const settled = await Promise.all(states.map((s) => s.connectedCallbackPromise.then(() => "ok", (e: Error) => e.message)));
      expect(settled[0]).toBe("ok");
      expect(settled[1]).toContain(`<${tag}> already has a connected <wcs-state bind-component="state">.`);
    });
    expect(root.querySelector(tag)!.shadowRoot!.querySelector("span")!.textContent).toBe("Alice");
    expect(errors.some((e) => e.includes("already has a connected"))).toBe(true);
  });
});

describe("サーバーが部品のクラスを知らずに描いた行", () => {
  it("クライアントで部品が先に定義されていても、ページの状態が行を引き取るまで待って配線される", async () => {
    const tag = `seam-ssr-${seq++}`;
    const html = `<wcs-state enable-ssr></wcs-state><template data-wcs="for: people"><${tag} class="row" data-wcs="state: ."></${tag}></template>`;
    const state = () => ({ people: [{ name: "Alice" }, { name: "Bob" }] });
    // the server: the tag is not defined there
    document.documentElement.setAttribute("data-wcs-server", "orchestrated");
    let out: string;
    try {
      const sh = document.createElement(`seam-server-${seq++}`);
      const sroot = sh.attachShadow({ mode: "open" });
      sroot.innerHTML = html;
      const sel = sroot.querySelector("wcs-state") as any;
      sel.setInitialState(state());
      document.body.appendChild(sh);
      await sel.connectedCallbackPromise;
      await getBindingsReady(sroot);
      for (let i = 0; i < 2; i++) await flush();
      (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(sroot);
      out = sroot.innerHTML;
      sh.remove();
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
    }
    // the rows carry no wiring and no mark
    expect(out).toContain(`<${tag} class="row"></${tag}>`);

    // the client: the part is defined first, the page's state arrives later
    part(`<span class="n">{{ name }}</span>`, () => ({}), tag);
    const h = document.createElement(`seam-client-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = out;
    const { errors } = await heard(async () => {
      document.body.appendChild(h);
      for (let i = 0; i < 2; i++) await flush();
      const el = root.querySelector("wcs-state") as any;
      el.setInitialState(state());
      await el.connectedCallbackPromise;
      await getBindingsReady(root);
      for (let i = 0; i < 4; i++) await flush();
    });
    expect(errors).toEqual([]);
    expect(Array.from(root.querySelectorAll(`${tag}.row`)).map((e) => e.shadowRoot!.querySelector(".n")!.textContent)).toEqual(["Alice", "Bob"]);
  });
});
