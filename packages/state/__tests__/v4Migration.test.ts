/**
 * v4Migration.test.ts — the 3.5 runtime notices for 4.0 (`[wcs/v4-migration]`, docs/state-3x-naming.ja.md D39).
 *
 * Pins, for every notice: the exact wording, the replacement it names, that it is printed once per page,
 * and that the canonical forms print nothing. Also pins where the notices are raised — only where an old
 * form is resolved — and that the split core (no receptacle placed) prints nothing.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import type { MockInstance } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { normalizeDeclarationAliases } from "../src/declarationAliases";
import { resolveFilterFn } from "../src/core/filterRegistry";
import { builtinFilterAliases } from "../src/filters/filterAliases";
import { builtinFilterArity } from "../src/formats/builtinFilters";
import { IV4MigrationNotices, setV4Migration, v4Migration } from "../src/core/v4MigrationHooks";
import { checkBootstrapOptionsForV4, clearV4MigrationWarningsForTesting, installV4Migration } from "../src/v4Migration";
import { getConfig } from "../src/config";

beforeAll(() => {
  bootstrapState();
});

const PREFIX = "[@wcstack/state] [wcs/v4-migration] ";
const SUFFIX = ' See "Preparing for 4.0" in the @wcstack/state README.';
const full = (message: string) => `${PREFIX}${message}${SUFFIX}`;

let warn: MockInstance<(...args: unknown[]) => void>;
/** Every `[wcs/v4-migration]` message printed so far, without the prefix and the suffix */
const notices = (): string[] =>
  warn.mock.calls
    .map((call) => String(call[0]))
    .filter((text) => text.startsWith(PREFIX))
    .map((text) => text.slice(PREFIX.length, text.length - SUFFIX.length));

beforeEach(() => {
  clearV4MigrationWarningsForTesting();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

const flush = () => new Promise((r) => setTimeout(r));
let counter = 0;

async function mountPage(state: object, body: string) {
  const host = document.createElement(`v4-migration-host-${++counter}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${body}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(state as Record<string, any>);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  const write = async (fn: (s: any) => void) => { stateElement.createState("writable", fn); await flush(); };
  const text = (id: string) => shadowRoot.getElementById(id)!.textContent;
  return { host, write, text };
}

describe("書式と 1 回だけ", () => {
  it("接頭辞・コード・README の節を付けて console.warn に出すこと", async () => {
    const { host } = await mountPage(
      { a: 1, get b(this: any) { this.$trackDependency("a"); return this.a; } },
      `<span id="b" data-wcs="textContent: b"></span>`,
    );
    expect(warn).toHaveBeenCalledWith(full(`"$trackDependency" is removed in 4.0: write "$dependOn" (its name since 3.2).`));
    host.remove();
  });

  it("同じ文面はページに 1 回だけ出すこと（評価が何度あっても）", async () => {
    const { host, write, text } = await mountPage(
      { a: 1, get b(this: any) { this.$trackDependency("a"); return this.a * 2; } },
      `<span id="b" data-wcs="textContent: b"></span><span id="c" data-wcs="textContent: b"></span>`,
    );
    await write((s) => { s.a = 2; });
    await write((s) => { s.a = 3; });
    expect(text("b")).toBe("6");
    expect(notices()).toEqual([`"$trackDependency" is removed in 4.0: write "$dependOn" (its name since 3.2).`]);
    host.remove();
  });
});

describe("3.2 の旧名 — state API", () => {
  it("$untrackDependency は $untracked を案内し、旧名のまま動くこと", async () => {
    const { host, text } = await mountPage(
      { a: 1, get b(this: any) { return this.$untrackDependency(() => this.a) + 1; } },
      `<span id="b" data-wcs="textContent: b"></span>`,
    );
    expect(text("b")).toBe("2");
    expect(notices()).toEqual([`"$untrackDependency" is removed in 4.0: write "$untracked" (its name since 3.2).`]);
    host.remove();
  });

  it("正式名 $dependOn / $untracked は何も出さないこと", async () => {
    const { host, write, text } = await mountPage(
      { a: 1, get b(this: any) { this.$dependOn("a"); return this.$untracked(() => this.a) + 1; } },
      `<span id="b" data-wcs="textContent: b"></span>`,
    );
    await write((s) => { s.a = 5; });
    expect(text("b")).toBe("6");
    expect(notices()).toEqual([]);
    host.remove();
  });
});

describe("3.2 の旧名 — 宣言キー", () => {
  it("$updatedCallback は $renderedCallback を案内すること", () => {
    normalizeDeclarationAliases({ $updatedCallback() {} });
    expect(notices()).toEqual([`"$updatedCallback" is removed in 4.0: write "$renderedCallback" (its name since 3.2).`]);
  });

  it("$streams は $stream を案内すること", () => {
    normalizeDeclarationAliases({ $streams: {} });
    expect(notices()).toEqual([`"$streams" is removed in 4.0: write "$stream" (its name since 3.2).`]);
  });

  it("class の state（プロトタイプのメソッド）も名指しすること", () => {
    class AppState {
      $updatedCallback(): void {}
    }
    normalizeDeclarationAliases(new AppState());
    expect(notices()).toEqual([`"$updatedCallback" is removed in 4.0: write "$renderedCallback" (its name since 3.2).`]);
  });

  it("同じ state オブジェクトは 1 回しか見ないこと（2 つの入口・再セット）", () => {
    const spy = vi.fn();
    const saved = v4Migration;
    setV4Migration({ ...saved!, state: spy });
    try {
      const state = { $streams: {} };
      normalizeDeclarationAliases(state);
      normalizeDeclarationAliases(state);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      setV4Migration(saved);
    }
  });

  it("ページに旧名の宣言があれば読み込みのときに出し、旧名のまま動くこと", async () => {
    let rendered = 0;
    const { host, write } = await mountPage(
      { a: 1, $updatedCallback() { rendered++; } },
      `<span id="a" data-wcs="textContent: a"></span>`,
    );
    await write((s) => { s.a = 2; });
    expect(rendered).toBeGreaterThan(0);
    expect(notices()).toEqual([`"$updatedCallback" is removed in 4.0: write "$renderedCallback" (its name since 3.2).`]);
    host.remove();
  });

  it("正式名 $renderedCallback / $stream は何も出さないこと", () => {
    normalizeDeclarationAliases({ $renderedCallback() {}, $stream: {} });
    expect(notices()).toEqual([]);
  });

  it("値が undefined の旧名は出さないこと（4.0 も undefined なら投げない）", () => {
    normalizeDeclarationAliases({ $updatedCallback: undefined, $streams: undefined });
    expect(notices()).toEqual([]);
  });
});

describe("3.2 の旧名 — フィルタ", () => {
  const out = (name: string, args: string[] = []) => resolveFilterFn(name, args, "output", args);

  it.each(Object.entries(builtinFilterAliases))("フィルタ %s は %s を案内すること", (alias, canonical) => {
    const minArgs = builtinFilterArity[canonical][0];
    out(alias, Array<string>(minArgs).fill("1"));
    expect(notices()).toEqual([`filter "${alias}" is removed in 4.0: write "${canonical}" (its name since 3.2).`]);
  });

  it("正式名を先に解決したページでも旧名を名指しすること（解決済みの鍵は正式名）", () => {
    out("upper")("a");
    expect(notices()).toEqual([]);
    expect(out("uc")("a")).toBe("A");
    expect(notices()).toEqual([`filter "uc" is removed in 4.0: write "upper" (its name since 3.2).`]);
  });

  it("束縛の旧名は、束縛が何本あっても 1 回だけ出すこと", async () => {
    const { host, text } = await mountPage(
      { name: "ab" },
      `<span id="a" data-wcs="textContent: name|uc"></span><span id="b" data-wcs="textContent: name|uc"></span>`,
    );
    expect(text("a")).toBe("AB");
    expect(notices()).toEqual([`filter "uc" is removed in 4.0: write "upper" (its name since 3.2).`]);
    host.remove();
  });
});

describe("4.0 が外すもの", () => {
  it("substr は slice(start, start + length) を案内し、3.x のまま動くこと", async () => {
    const { host, text } = await mountPage(
      { s: "abcdef" },
      `<span id="a" data-wcs="textContent: s|substr(1,3)"></span><span id="b" data-wcs="textContent: s|substr(0,2)"></span>`,
    );
    expect(text("a")).toBe("bcd");
    expect(text("b")).toBe("ab");
    expect(notices()).toEqual([
      `filter "substr" is removed in 4.0: write slice(start, start + length) — slice takes the end index, not a length.`,
    ]);
    host.remove();
  });

  it("slice は何も出さないこと", async () => {
    const { host, text } = await mountPage({ s: "abcdef" }, `<span id="a" data-wcs="textContent: s|slice(1,4)"></span>`);
    expect(text("a")).toBe("bcd");
    expect(notices()).toEqual([]);
    host.remove();
  });

  it("$scan は $watch / $on を案内すること", () => {
    normalizeDeclarationAliases({ count: 0, $scan: {} });
    expect(notices()).toEqual([`"$scan" is removed in 4.0: rewrite it with $watch (state paths) or $on (event tokens).`]);
  });

  it("$watch / $on は何も出さないこと", () => {
    normalizeDeclarationAliases({ count: 0, $watch: {}, $on: {} });
    expect(notices()).toEqual([]);
  });

  it("値が undefined の $scan は出さないこと（4.0 も undefined なら投げない）", () => {
    normalizeDeclarationAliases({ count: 0, $scan: undefined });
    expect(notices()).toEqual([]);
  });
});

describe("bootstrapState の設定", () => {
  it.each(["debug", "commentTextPrefix", "enablePropagationContext"])("外れる %s は「4.0 で外れる」と出すこと", (key) => {
    checkBootstrapOptionsForV4({ [key]: key === "commentTextPrefix" ? "wcs-text" : false });
    expect(notices()).toEqual([`bootstrapState option "${key}" is removed in 4.0, which throws on it. Remove it.`]);
  });

  it.each([
    ["enableMustache", false],
    ["sameValueGuard", false],
    ["enableDirectionalInitialSync", true],
  ])("%s は state の $behavior へ移ることと、書く値を示すこと", (key, value) => {
    checkBootstrapOptionsForV4({ [key]: value });
    expect(notices()).toEqual([
      `bootstrapState option "${key}" moves to the state's $behavior in 4.0, which throws on it here. ` +
      `When you upgrade, write $behavior: { ${key}: ${value} } in the state.`,
    ]);
  });

  it.each([
    [{ enableMustache: "false" }, "enableMustache"],
    [{ sameValueGuard: 1n }, "sameValueGuard"],
    [{ enableDirectionalInitialSync: null }, "enableDirectionalInitialSync"],
  ])("$behavior へ移る設定に boolean でない値 %s を渡すと、値を埋め込まずに型の違いとして出すこと", (options, key) => {
    expect(() => checkBootstrapOptionsForV4(options)).not.toThrow();
    expect(notices()).toEqual([`bootstrapState: "${key}" is not one of its options, or not of the option's type. 4.0 throws on it.`]);
  });

  it("BigInt や循環する値を渡しても投げないこと", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => checkBootstrapOptionsForV4({ locale: 1n, tagNames: { state: 2n }, foo: circular })).not.toThrow();
    expect(notices()).toEqual([
      `bootstrapState: "locale" is not one of its options, or not of the option's type. 4.0 throws on it.`,
      `bootstrapState: "tagNames.state" is not one of its options, or not of the option's type. 4.0 throws on it.`,
      `bootstrapState: "foo" is not one of its options, or not of the option's type. 4.0 throws on it.`,
    ]);
  });

  it.each([
    [{ foo: 1 }, "foo"],
    [{ locale: 5 }, "locale"],
    [{ bindAttributeName: null }, "bindAttributeName"],
    [{ tagNames: [] }, "tagNames"],
    [{ tagNames: "x-state" }, "tagNames"],
    [{ enableContractAnalyzer: "yes" }, "enableContractAnalyzer"],
    [{ tagNames: { state: 5 } }, "tagNames.state"],
    [{ tagNames: { other: "x-other" } }, "tagNames.other"],
  ])("4.0 が投げる設定 %j は %s を名指しすること", (options, key) => {
    checkBootstrapOptionsForV4(options);
    expect(notices()).toEqual([`bootstrapState: "${key}" is not one of its options, or not of the option's type. 4.0 throws on it.`]);
  });

  it("4.0 が受け取る設定と undefined の値は何も出さないこと", () => {
    checkBootstrapOptionsForV4({
      bindAttributeName: "data-wcs",
      commentForPrefix: "wcs-for",
      commentIfPrefix: "wcs-if",
      commentElseIfPrefix: "wcs-elseif",
      commentElsePrefix: "wcs-else",
      tagNames: { state: "wcs-state", ssr: "wcs-ssr", other: undefined },
      locale: "en",
      enableContractAnalyzer: false,
      debug: undefined,
    });
    checkBootstrapOptionsForV4(undefined);
    expect(notices()).toEqual([]);
  });

  it("bootstrapState() は設定を当てる前に見て、3.x の挙動は変えないこと", () => {
    const before = getConfig().enableMustache;
    bootstrapState({ enableMustache: before, debug: false });
    expect(getConfig().enableMustache).toBe(before);
    expect(notices()).toEqual([
      `bootstrapState option "enableMustache" moves to the state's $behavior in 4.0, which throws on it here. ` +
      `When you upgrade, write $behavior: { enableMustache: ${before} } in the state.`,
      `bootstrapState option "debug" is removed in 4.0, which throws on it. Remove it.`,
    ]);
  });

  it("引数の無い bootstrapState() は何も出さないこと", () => {
    bootstrapState();
    expect(notices()).toEqual([]);
  });
});

describe("4.0 の $behavior / $features", () => {
  it("3.x が動かしている値と同じ $behavior は何も出さないこと", () => {
    normalizeDeclarationAliases({ $behavior: { enableMustache: true, sameValueGuard: true, enableDirectionalInitialSync: true } });
    normalizeDeclarationAliases({ $behavior: {} });
    normalizeDeclarationAliases({ $behavior: null });
    expect(notices()).toEqual([]);
  });

  it("3.x の動きと違う $behavior は、3.x では効かないことと bootstrapState の書き方を示すこと", () => {
    normalizeDeclarationAliases({ $behavior: { sameValueGuard: false } });
    expect(notices()).toEqual([
      `$behavior takes effect in 4.0; 3.x does not read it and runs this state with sameValueGuard: true. ` +
      `Until you upgrade, pass bootstrapState({ sameValueGuard: false }).`,
    ]);
  });

  it("$behavior を宣言しても 3.x の挙動は変わらないこと（同値ガードは効いたまま）", async () => {
    let renders = 0;
    const { host, write } = await mountPage(
      { a: 1, $behavior: { sameValueGuard: false }, $renderedCallback() { renders++; } },
      `<span id="a" data-wcs="textContent: a"></span>`,
    );
    const before = renders;
    await write((s) => { s.a = 1; });
    expect(renders).toBe(before);
    host.remove();
  });

  it.each([
    [{ $behavior: true }, `state: "$behavior" is not one of its options, or not an object. 4.0 throws on it.`],
    [{ $behavior: { mustache: false } }, `$behavior: "mustache" is not one of its options, or not a boolean. 4.0 throws on it.`],
    [{ $behavior: { enableMustache: "false" } }, `$behavior: "enableMustache" is not one of its options, or not a boolean. 4.0 throws on it.`],
  ])("4.0 が投げる $behavior %j を名指しすること", (state, message) => {
    normalizeDeclarationAliases(state);
    expect(notices()).toEqual([message]);
  });

  it("後付けの名前の配列の $features は何も出さないこと", () => {
    normalizeDeclarationAliases({ $features: ["formats", "temporal", "list-keys"] });
    normalizeDeclarationAliases({ $features: [] });
    expect(notices()).toEqual([]);
  });

  it.each([
    [{ $features: "temporal" }],
    [{ $features: ["temporal", "watch"] }],
    [{ $features: null }],
  ])("4.0 が投げる $features %j を名指しすること", (state) => {
    normalizeDeclarationAliases(state);
    expect(notices()).toEqual([
      `$features is not an array of add-on names (formats, diagnostics, temporal, list-keys, scopes, recursion, ssr, devtools). 4.0 throws on it.`,
    ]);
  });
});

describe("4.0 が接ぎ木しないボリューム", () => {
  async function mountVolume(volumeState: Record<string, unknown>, rootJson = '{"count":1,"settings2":{"tax":0.1}}', volumeBind = "") {
    const host = document.createElement(`v4-migration-volume-${++counter}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state mount="settings"${volumeBind ? ` data-wcs="${volumeBind}"` : ""}></wcs-state>` +
      `<wcs-state json='${rootJson}'></wcs-state>` +
      `<span id="t" data-wcs="textContent: settings.theme"></span>`;
    document.body.appendChild(host);
    const volumeElement = shadowRoot.querySelector("wcs-state[mount]") as State;
    const rootElement = shadowRoot.querySelector("wcs-state:not([mount])") as State;
    volumeElement.setInitialState(volumeState);
    await rootElement.connectedCallbackPromise;
    await volumeElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    const root = getStateElement(shadowRoot)!;
    const write = async (fn: (s: any) => void) => { root.createState("writable", fn); await flush(); };
    const read = (path: string): unknown => { let v: unknown; root.createState("readonly", (s: any) => { v = s[path]; }); return v; };
    return { host, write, read, text: () => shadowRoot.getElementById("t")!.textContent };
  }
  const refused = (key: string, advice: string) =>
    `volume "settings" declares ${key}: 4.0 does not graft a volume that declares it. ${advice}`;

  it("$watch / $listKeys / $renderedCallback を名指しし、3.x ではマウント相対のまま動くこと", async () => {
    const seen: unknown[] = [];
    let rendered = 0;
    const { host, write, text } = await mountVolume({
      theme: "dark",
      rows: [{ id: 1 }],
      $watch: { theme(value: unknown) { seen.push(value); } },
      $listKeys: { rows: "id" },
      $renderedCallback() { rendered++; },
    });
    expect(text()).toBe("dark");
    await write((s) => { s["settings.theme"] = "light"; });
    expect(text()).toBe("light");
    expect(seen).toEqual(["light"]);
    expect(rendered).toBeGreaterThan(0);
    expect(notices()).toEqual([
      refused("$watch", "Move it to the root state, where its paths are absolute."),
      refused("$listKeys", "Move it to the root state, where its paths are absolute."),
      refused("$renderedCallback", "Move it to the root state, where it receives absolute paths."),
    ]);
    host.remove();
  });

  it("$updatedCallback は改名の案内とボリュームの案内を 1 回ずつ出すこと（重複しない）", async () => {
    class VolumeState {
      theme = "dark";
      $updatedCallback(): void {}
    }
    const { host } = await mountVolume(new VolumeState() as unknown as Record<string, unknown>);
    expect(notices()).toEqual([
      `"$updatedCallback" is removed in 4.0: write "$renderedCallback" (its name since 3.2).`,
      refused("$renderedCallback", "Move it to the root state, where it receives absolute paths."),
    ]);
    host.remove();
  });

  it("$behavior / $features はボリュームの案内だけを出すこと（値が 3.x の設定と違っても bootstrapState の案内は出さない）", async () => {
    const { host, text } = await mountVolume({
      theme: "dark",
      $behavior: { sameValueGuard: false },
      $features: "temporal",
    });
    expect(text()).toBe("dark");
    expect(notices()).toEqual([
      refused("$behavior", "Declare it on the root state."),
      refused("$features", "Declare it on the root state."),
    ]);
    host.remove();
  });

  it("ルートのパスを注入するボリュームを名指しし、3.x では注入が動くこと", async () => {
    const { host, write, read } = await mountVolume(
      { theme: "dark", get taxLabel(this: any) { return `tax ${this.tax}`; } },
      '{"count":1,"settings2":{"tax":0.1}}',
      "state.tax: settings2.tax",
    );
    expect(read("settings.taxLabel")).toBe("tax 0.1");
    await write((s) => { s["settings2.tax"] = 0.2; });
    expect(read("settings.taxLabel")).toBe("tax 0.2");
    expect(notices()).toEqual([
      `volume "settings" injects root paths (data-wcs="state.<key>: …"): 4.0 does not graft a volume with injections. ` +
      `Read the root path in a root getter instead.`,
    ]);
    host.remove();
  });

  it("どれも宣言しない（または undefined の）ボリュームは何も出さないこと", async () => {
    const { host, text } = await mountVolume({ theme: "light", $behavior: undefined, $watch: undefined });
    expect(text()).toBe("light");
    expect(notices()).toEqual([]);
    host.remove();
  });
});

describe("呼ばれる場所（普通の経路には判定を足さない）", () => {
  const spyNotices = () => {
    const spy = { state: vi.fn(), volumeLoaded: vi.fn(), renamed: vi.fn(), removed: vi.fn(), volume: vi.fn() };
    return spy satisfies IV4MigrationNotices;
  };

  it("正式名だけのページでは、state の読み込みのほかに受け口を呼ばないこと", async () => {
    const saved = v4Migration;
    const spy = spyNotices();
    setV4Migration(spy);
    try {
      const { host, write, text } = await mountPage(
        {
          s: "abc",
          items: [{ v: 1 }, { v: 2 }],
          get total(this: any) { this.$dependOn("items"); return this.$untracked(() => this.items.length); },
          $renderedCallback() {},
        },
        `<span id="s" data-wcs="textContent: s|upper|slice(0,2)"></span>` +
        `<span id="t" data-wcs="textContent: total"></span>` +
        `<template data-wcs="for: items"><i data-wcs="textContent: .v|add(1)"></i></template>`,
      );
      await write((st) => { st.s = "xyz"; st.items = [...st.items, { v: 3 }]; });
      expect(text("s")).toBe("XY");
      expect(spy.renamed).not.toHaveBeenCalled();
      expect(spy.removed).not.toHaveBeenCalled();
      expect(spy.volume).not.toHaveBeenCalled();
      expect(spy.volumeLoaded).not.toHaveBeenCalled();
      // the only call: the state object entering the runtime, once
      expect(spy.state).toHaveBeenCalledTimes(1);
      host.remove();
    } finally {
      setV4Migration(saved);
    }
  });

  it("受け口が無ければ（分割の /core）何も出さず、旧名もそのまま動くこと", async () => {
    const saved = v4Migration;
    setV4Migration(null);
    try {
      const { host, text } = await mountPage(
        { s: "ab", $updatedCallback() {}, get b(this: any) { this.$trackDependency("s"); return this.s; } },
        `<span id="a" data-wcs="textContent: s|uc"></span><span id="b" data-wcs="textContent: b|substr(0,1)"></span>`,
      );
      expect(text("a")).toBe("AB");
      expect(text("b")).toBe("a");
      expect(notices()).toEqual([]);
      host.remove();
    } finally {
      setV4Migration(saved);
    }
  });

  it("installV4Migration は冪等で、受け口を置き直すこと", () => {
    installV4Migration();
    installV4Migration();
    expect(v4Migration).not.toBeNull();
    normalizeDeclarationAliases({ $streams: {} });
    expect(notices()).toHaveLength(1);
  });
});
