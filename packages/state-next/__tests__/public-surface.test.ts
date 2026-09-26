/**
 * public-surface.test.ts — 公開面が @wcstack/state 3.3 と同じであること。
 * 3.3 側はコミット済みの配布物（packages/state/dist の .d.ts・wcs-manifest.json・parser.esm.js）、
 * 4.0 側は各入口のソースを読む。意図した差は下の表に理由付きで書く。
 */
import { describe, it, expect } from "vitest";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(__dirname, "..");
const V3 = resolve(ROOT, "../state");

/** An entry's exports, name → "value" | "type", by the TypeScript checker. */
function exportsOf(file: string): Map<string, "value" | "type"> {
  const program = ts.createProgram([file], {
    noEmit: true, skipLibCheck: true, strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    resolveJsonModule: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file)!;
  const out = new Map<string, "value" | "type">();
  for (const e of checker.getExportsOfModule(checker.getSymbolAtLocation(source)!)) {
    const s = e.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(e) : e;
    out.set(e.name, s.flags & ts.SymbolFlags.Value ? "value" : "type");
  }
  return out;
}

const FEATURES_V3 = ["temporal", "scopes", "recursion", "ssr", "devtools", "formats", "diagnostics"];

/** [entry, 3.3 .d.ts, 4.0 source] */
const ENTRIES: [string, string, string][] = [
  [".", "dist/index.d.ts", "src/exports.ts"],
  ["./core", "dist/split/core.d.ts", "src/core.ts"],
  ...FEATURES_V3.map((f): [string, string, string] => [`./features/${f}`, `dist/split/features/${f}.d.ts`, `src/features/${f}.ts`]),
  ["./define", "dist/define.d.ts", "src/public/defineState.ts"],
  ["./manifest", "dist/manifest.d.ts", "src/public/manifest.ts"],
  ["./parser", "dist/parser.d.ts", "src/public/parser.ts"],
];

/** Names 4.0 adds, by entry (each with its reason). */
const ADDED: Record<string, Record<string, string>> = {
  ".": { IStateElement: "README の IStateElement の表を型にした（3.3 は State クラスを型の補強にだけ使っていた）" },
};

describe("入口ごとの export が 3.3 と同じ", () => {
  for (const [entry, v3File, v4File] of ENTRIES) {
    it(entry, () => {
      const v3 = exportsOf(join(V3, v3File));
      const v4 = exportsOf(join(ROOT, v4File));
      const added = ADDED[entry] ?? {};
      const missing = [...v3.keys()].filter((n) => !v4.has(n));
      const extra = [...v4.keys()].filter((n) => !v3.has(n) && !(n in added));
      const kind = [...v3].filter(([n, k]) => v4.has(n) && v4.get(n) !== k).map(([n, k]) => `${n}: ${k} → ${v4.get(n)}`);
      expect({ missing, extra, kind }).toEqual({ missing: [], extra: [], kind: [] });
    });
  }

  it("4.0 は後付けの入口 features/list-keys を足す（3.3 は $listKeys を core に持っていた）", () => {
    const v4 = exportsOf(join(ROOT, "src/features/list-keys.ts"));
    expect([...v4.keys()].sort()).toEqual(["default", "listKeys"]);
  });

  it("package.json の exports の入口と、指す先のファイルの配置が 3.3 と同じ", () => {
    const v3 = JSON.parse(readFileSync(join(V3, "package.json"), "utf8"));
    const v4 = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(v4.exports).toEqual(v3.exports);
    expect({ main: v4.main, module: v4.module, types: v4.types }).toEqual({ main: v3.main, module: v3.module, types: v3.types });
  });
});

describe("manifest が 3.3 と同じ（4.0 の意図した差を除く）", () => {
  it("構文・フィルタ・メタデータ・予約名", async () => {
    const v3 = JSON.parse(readFileSync(join(V3, "dist/wcs-manifest.json"), "utf8"));
    const { getWcsManifest } = await import("../src/public/manifest");
    const v4 = JSON.parse(JSON.stringify(getWcsManifest()));
    expect(v4.version).toBe(v3.version);
    expect(v4.syntax).toEqual(v3.syntax);
    expect([...v4.filters].sort()).toEqual([...v3.filters].sort());
    expect(v4.filterMeta).toEqual(v3.filterMeta);
    expect(v4.reservedLifecycle).toEqual(v3.reservedLifecycle);
    // 4.0: $scan is removed; the old filter / declaration names are gone from the runtime
    expect(v4.reservedStateApi).toEqual(v3.reservedStateApi.filter((n: string) => n !== "$scan"));
    expect(v4.filterAliases).toEqual({});
    expect(v4.declarationAliases).toEqual({});
    expect(v4.apiAliases).toEqual(v3.apiAliases);
  });

  it("各フィルタのメタデータの引数の数が、実装の引数の数と一致する", async () => {
    const { builtinFilterMeta } = await import("../src/public/manifest");
    const { coreFilters } = await import("../src/filters/core");
    const { formatFilters } = await import("../src/filters/formats");
    const defs: Record<string, any> = { ...coreFilters, ...formatFilters };
    const mismatch = Object.entries(builtinFilterMeta)
      .map(([name, m]) => ({ name, meta: [m.minArgs, m.maxArgs], impl: defs[name]?.arity ?? [] }))
      .filter((x) => x.meta[0] !== x.impl[0] || x.meta[1] !== x.impl[1]);
    expect(mismatch).toEqual([]);
  });
});

describe("parser の結果と誤りの文面が 3.3 と同じ", () => {
  const TEXTS = [
    "textContent: user.name",
    "value#ro: form.email|trim|lower",
    "class.active: items.*.selected; attr.title: items.*.label|truncate(10)",
    "onclick#prevent: save",
    "for: items",
    "if: user.admin|not",
    "else:",
    "...: widget",
    "eventToken.change: changed",
    "command.play: $command.play",
    ".online: net.online",
    "value#init=element,sync=connect: widget.snapshot",
    "textContent: price|toFixed(2)|locale(ja-JP)",
  ];
  const BAD = [
    "textContent user.name",
    "textContent: a|b(",
    "textContent: a|b)",
    "textContent: a|)b(",
    "textContent: a||b",
    "for#ro: items",
    "else: x",
    "...: ",
    "textContent: nodes.**.v",
    "textContent: @main.x",
    "if: a; for: b",
    "value#ro#wo: x",
    "textContent: a.",
    "...: w|upper",
    ".class.active: a",
    "textContent: a|join('x)",
    "textContent: a|b(1)c",
    "value|trim#ro: x",
    "textContent: a|trim#ro",
    ": x",
    "#ro: x",
    "textContent: " + Array.from({ length: 513 }, (_, i) => "s" + i).join("."),
    "textContent: .a..b",
    "if#ro: x",
    "...#ro: x",
  ];
  /** A parsed binding as data (statePathInfo reduced to its plain fields). */
  const plain = (b: any) => ({
    ...b,
    statePathInfo: b.statePathInfo && {
      path: b.statePathInfo.path, segments: b.statePathInfo.segments, cumulativePaths: b.statePathInfo.cumulativePaths,
      parentPath: b.statePathInfo.parentPath, wildcardPaths: b.statePathInfo.wildcardPaths,
      wildcardParentPaths: b.statePathInfo.wildcardParentPaths, wildcardPositions: b.statePathInfo.wildcardPositions,
      lastWildcardPath: b.statePathInfo.lastWildcardPath, wildcardCount: b.statePathInfo.wildcardCount,
      indexByWildcardPath: b.statePathInfo.indexByWildcardPath,
    },
    // 3.x gave structural bindings a uuid; 4.0 has none
    uuid: undefined,
    inFilters: b.inFilters.map((f: any) => ({ filterName: f.filterName, args: f.args })),
    outFilters: b.outFilters.map((f: any) => ({ filterName: f.filterName, args: f.args })),
  });
  // 3.3's parser, copied into this package (vitest does not load a module from outside it)
  const load = async () => {
    const dir = join(ROOT, "node_modules/.cache/state-next");
    mkdirSync(dir, { recursive: true });
    const copy = join(dir, "parser-3.3.mjs");
    copyFileSync(join(V3, "dist/parser.esm.js"), copy);
    return {
      v3: await import(/* @vite-ignore */ `${pathToFileURL(copy).href}?t=${Date.now()}`),
      v4: await import("../src/public/parser"),
    };
  };

  it("parseBindTextsForElement / parseBindTextForEmbeddedNode / splitBindTexts", async () => {
    const { v3, v4 } = await load();
    for (const t of TEXTS) {
      expect(v4.parseBindTextsForElement(t).map(plain), t).toEqual(v3.parseBindTextsForElement(t).map(plain));
      expect(v4.splitBindTexts(t), t).toEqual(v3.splitBindTexts(t));
    }
    expect(plain(v4.parseBindTextForEmbeddedNode("user.name|upper"))).toEqual(plain(v3.parseBindTextForEmbeddedNode("user.name|upper")));
  });

  it("getPathInfo", async () => {
    const { v3, v4 } = await load();
    for (const p of ["a", "a.b.c", "items.*.name", "groups.*.items.*.v", "x.*"]) {
      expect(plain({ inFilters: [], outFilters: [], statePathInfo: v4.getPathInfo(p) }), p)
        .toEqual(plain({ inFilters: [], outFilters: [], statePathInfo: v3.getPathInfo(p) }));
    }
    v4.clearParserCaches();
    expect(v4.getPathInfo("a.b")).not.toBe(undefined);
  });

  it("誤りの文面", async () => {
    const { v3, v4 } = await load();
    const message = (fn: () => unknown): string => {
      try { fn(); return "(no error)"; } catch (e) { return (e as Error).message; }
    };
    const diff = BAD.map((t) => ({ t, v3: message(() => v3.parseBindTextsForElement(t)), v4: message(() => v4.parseBindTextsForElement(t)) }))
      .filter((x) => x.v3 !== x.v4);
    expect(diff).toEqual([]);
  });
});
