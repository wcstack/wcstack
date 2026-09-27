/**
 * integration.ssrDeferredSpreadRow.test.ts — サーバーが描いた行・枝の中の、未定義カスタム要素への spread
 * （`...: .`）を、**実際のサーバー出力**から固定する（#358）。
 *
 * #330 で行の spread は定義まで展開を遅らせ、定義後に行のループ文脈で展開するようになった（CSR の行は
 * createContent が `content.spreads` に持ち、activateContent が定義待ちへ予約する）。ハイドレーションで
 * 作る行はこれを持たなかった:
 *  - 展開した束縛を行の束縛の列に足さず、行をプールから使い回しても当て直さなかった（消した行の値を出し、
 *    書き込みにも追従しない）。
 *  - 展開を待つノードに登録済みの印を付けず、body 全体の走査がもう一度拾ってループ文脈なしの 2 つ目の
 *    展開を予約した。定義されると後の方が行のノードの文脈を空にし、要素の出力の書き戻しが
 *    `ListIndex not found: items.*.status` で失敗した（行の数だけ）。
 *
 * 契約: ハイドレーションで作った行・枝の spread は、CSR の行と同じく定義後に行ごとに 1 度だけ展開され、
 * 使い回し・書き込み・定義前の使い回しで CSR と同じ表示になり、CSR に無い報告を出さない。
 *
 * 後から定義される要素は integration.spreadDeferredTemplate.test.ts と同じく registry の差し込みで模す
 * （happy-dom の本物の define は接続済みの要素を別ノードに差し替える）。実 Chromium の本物の define は
 * Issue #358 の検証で別に確かめた。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { getDefinitionCoordinator } from "../src/bindings/DefinitionCoordinator";
import { write } from "./helpers/recursionTestUtils";
import { clientLoad, csrMarkup, serverRender, settle } from "./helpers/ssrRoundTrip";

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as any).customElementRegistry;
  document.body.innerHTML = "";
});

/** 後から定義される要素（フィールド初期化子を持たせない — upgrade はプロトタイプの付け替えで模す） */
function greetClass(tag: string): CustomElementConstructor {
  return class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [{ name: "status", event: `${tag}:status` }],
      inputs: [{ name: "name" }],
    };
    set name(v: unknown) {
      (this as any)._n = v;
      this.textContent = `hello ${v}`;
    }
    get name(): unknown { return (this as any)._n; }
    get status(): unknown { return "ready"; }
  };
}

/** 1 つのタグだけ「後から定義される」registry（integration.spreadDeferredTemplate.test.ts と同じ） */
function lateRegistry(tag: string) {
  const cls = greetClass(tag);
  let defined = false;
  let resolve!: (c: CustomElementConstructor) => void;
  const promise = new Promise<CustomElementConstructor>((r) => { resolve = r; });
  const registry = {
    get: (name: string) => (name === tag ? (defined ? cls : undefined) : customElements.get(name)),
    whenDefined: (name: string) => (name === tag ? promise : customElements.whenDefined(name)),
    upgrade: (root: Node) => {
      if (defined && (root as Element).localName === tag) Object.setPrototypeOf(root, cls.prototype);
    },
  };
  Object.defineProperty(HTMLElement.prototype, "customElementRegistry", {
    configurable: true,
    get(this: Element) { return this.localName === tag ? registry : undefined; },
  });
  return {
    define(): void { defined = true; resolve(cls); },
    pending(): number { return getDefinitionCoordinator(registry).pendingCount(tag); },
  };
}

type Step = ((s: any) => void) | "define";

interface IRun {
  views: string[];
  errors: string[];
  /** 読み込み直後の定義待ちの数 */
  pending: number;
}

let seq = 0;

/** 読み込み（CSR なら描画、SSR ならハイドレーション）→ 手順（"define" は定義）を 1 つずつ流す */
async function run(html: string, tag: string, make: () => any, steps: Step[], view: () => string): Promise<IRun> {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  const late = lateRegistry(tag);
  try {
    const el = await clientLoad(html, make);
    const pending = late.pending();
    const views = [view()];
    for (const step of steps) {
      if (step === "define") late.define();
      else write(el, step);
      await settle();
      views.push(view());
    }
    return { views, errors, pending };
  } finally {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as any).customElementRegistry;
    document.body.innerHTML = "";
    await settle();
  }
}

/** CSR の対照と、サーバー描画（要素は未定義のまま）→ ハイドレーションを同じ手順で流す */
async function compare(body: (tag: string) => string, data: Record<string, unknown>, steps: Step[], view: (tag: string) => () => string)
  : Promise<{ csr: IRun; ssr: IRun }> {
  const tag = `ssr-late-spread-${++seq}`;
  const markup = `<wcs-state enable-ssr></wcs-state>${body(tag)}`;
  const make = (): any => structuredClone(data);
  const csr = await run(csrMarkup(markup), tag, make, steps, view(tag));
  // サーバーでも未定義（定義されない registry）
  lateRegistry(tag);
  const serverHtml = await serverRender(markup, make);
  delete (HTMLElement.prototype as any).customElementRegistry;
  const ssr = await run(serverHtml, tag, make, steps, view(tag));
  return { csr, ssr };
}

const greets = (tag: string) => (): string =>
  Array.from(document.querySelectorAll(tag)).map((el) => el.textContent || "-").join(" / ");

describe("#358: サーバーが描いた行の、未定義カスタム要素への spread", () => {
  it("定義後に行ごとに 1 度だけ展開され、使い回した行が新しい行の値を出す（旧: ListIndex not found が行の数だけ出て、足した行が消した行の値を出した）", async () => {
    const { csr, ssr } = await compare(
      (tag) => `<ul><template data-wcs="for: items"><li><${tag} data-wcs="...: ."></${tag}></li></template></ul>` +
        `<p><${tag} data-wcs="...: one"></${tag}></p>`,
      { items: [{ name: "a" }, { name: "b" }], one: { name: "z" }, status: "" },
      ["define",
        (s) => { s["items.1.name"] = "B"; },
        (s) => { s.items = s.items.slice(1); },
        (s) => { s.items = [...s.items, { name: "c" }]; },
        (s) => { s["items.1.name"] = "C"; }],
      greets);
    // 待ちは要素ごとに 1 つ（旧: 行の要素は body 全体の走査でもう 1 つ予約され、2 行 × 2 ＋ 1 = 5）
    expect(csr.pending).toBe(3);
    expect(ssr.pending).toBe(csr.pending);
    expect(csr.views).toEqual(["- / - / -", "hello a / hello b / hello z", "hello a / hello B / hello z",
      "hello B / hello z", "hello B / hello c / hello z", "hello B / hello C / hello z"]);
    expect(ssr.views).toEqual(csr.views);
    // CSR と同じ報告だけ（`one.status` が state に無いことの binding-path-missing — 本件とは別。
    // 旧: 行ごとの `deferred spread failed … ListIndex not found: items.*.status` と、SSR でだけ出る
    // `items.*.status` の binding-path-missing が加わった）
    expect(ssr.errors).toEqual(csr.errors);
    expect(ssr.errors.join("\n")).not.toContain("items.*.status");
  });

  it("定義前に消して足した（使い回した）行も、定義後に新しい行の値で展開され、書き込みに追従する", async () => {
    const { csr, ssr } = await compare(
      (tag) => `<ul><template data-wcs="for: items"><li><${tag} data-wcs="...: ."></${tag}></li></template></ul>`,
      { items: [{ name: "a" }, { name: "b" }] },
      [(s) => { s.items = s.items.slice(1); },
        (s) => { s.items = [...s.items, { name: "c" }]; },
        "define",
        (s) => { s["items.1.name"] = "C"; },
        (s) => { s.items = s.items.slice(1); },
        (s) => { s.items = [...s.items, { name: "d" }]; }],
      greets);
    expect(csr.views).toEqual(["- / -", "-", "- / -", "hello b / hello c", "hello b / hello C", "hello C", "hello C / hello d"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual(csr.errors);
  });

  it("行の添字の束縛（`$1`）を併せた要素は、展開後に行の添字が変わると当て直される", async () => {
    const indexes = (tag: string) => (): string =>
      Array.from(document.querySelectorAll(tag)).map((el) => `${el.textContent || "-"}@${el.getAttribute("data-i")}`).join(" / ");
    const { csr, ssr } = await compare(
      (tag) => `<ul><template data-wcs="for: items"><li><${tag} data-wcs="...: .; attr.data-i: $1"></${tag}></li></template></ul>`,
      { items: [{ name: "a" }, { name: "b" }] },
      ["define",
        (s) => { s.items = [{ name: "z" }, ...s.items]; },
        (s) => { s.items = [...s.items].reverse(); }],
      indexes);
    expect(csr.views).toEqual(["-@null / -@null", "hello a@0 / hello b@1", "hello z@0 / hello a@1 / hello b@2",
      "hello b@0 / hello a@1 / hello z@2"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual(csr.errors);
  });

  it("サーバーが描いた if の枝の spread は、定義前に閉じても開き直すと展開され、書き込みに追従する", async () => {
    const { csr, ssr } = await compare(
      (tag) => `<div><template data-wcs="if: show"><${tag} data-wcs="...: one"></${tag}></template></div>`,
      { show: true, one: { name: "z", status: "" } },
      [(s) => { s.show = false; },
        "define",
        (s) => { s.show = true; },
        (s) => { s["one.name"] = "y"; }],
      greets);
    expect(csr.views).toEqual(["-", "", "", "hello z", "hello y"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual(csr.errors);
  });

  it("サーバーが描いた行の中の if の枝の spread は、開いたまま定義すると行の文脈で展開され、書き込みに追従する", async () => {
    // 行の中の枝は置き場の行の文脈で予約する（ハイドレーションの if のブロック）。文脈なしで予約すると、
    // 定義後の展開が `.` を行に解決できなかった
    const { csr, ssr } = await compare(
      (tag) => `<ul><template data-wcs="for: items"><li><template data-wcs="if: .show"><${tag} data-wcs="...: ."></${tag}></template></li></template></ul>`,
      { items: [{ name: "a", show: true, status: "" }, { name: "b", show: true, status: "" }] },
      ["define",
        (s) => { s["items.1.name"] = "B"; },
        (s) => { s["items.0.show"] = false; },
        (s) => { s["items.0.show"] = true; },
        (s) => { s["items.0.name"] = "A"; }],
      greets);
    expect(csr.views).toEqual(["- / -", "hello a / hello b", "hello a / hello B", "hello B", "hello a / hello B",
      "hello A / hello B"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual(csr.errors);
  });
});
