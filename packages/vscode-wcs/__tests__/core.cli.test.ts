import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { createPositionMapper } from "../src/core/offsetToPosition.js";
import { validateDocument } from "../src/core/validateDocument.js";
import { runValidation, type CliFileInput } from "../src/core/cli/runValidation.js";
import { WcsDiagnosticCode, severityToLsp } from "../src/core/diagnostics.js";
import type { LiveBindableDeclaration } from "../src/core/sidecar/types.js";
import { createFileReader } from "../src/cli.js";

describe("offsetToPosition", () => {
  it("offset を 1-based line:column に写像する", () => {
    const text = "abc\ndef\n\nghij";
    const map = createPositionMapper(text);
    expect(map(0)).toEqual({ line: 1, column: 1 });
    expect(map(2)).toEqual({ line: 1, column: 3 });
    expect(map(4)).toEqual({ line: 2, column: 1 }); // after first \n
    expect(map(text.indexOf("ghij"))).toEqual({ line: 4, column: 1 });
    // clamp
    expect(map(-5)).toEqual({ line: 1, column: 1 });
    expect(map(9999)).toEqual({ line: 4, column: 5 });
  });
});

describe("validateDocument — aggregator produces coded diagnostics", () => {
  const html = `
<wcs-state json='{"count": 1}'></wcs-state>
<span data-wcs="textContent: count | nope"></span>
<span data-wcs="textContent: missingPath"></span>
`;

  it("未知フィルタ・存在しないパスに安定 code が付く", () => {
    const diags = validateDocument(html);
    const byCode = new Map(diags.map((d) => [d.code, d]));
    expect(byCode.has(WcsDiagnosticCode.FilterUnknown)).toBe(true);
    expect(byCode.has(WcsDiagnosticCode.BindingPathMissing)).toBe(true);
    // 全診断が code を持ち range も持つ
    expect(diags.every((d) => typeof d.code === "string" && d.end >= d.start)).toBe(true);
  });
});

describe("IDE / CI parity — 同一入力から同一 {code, range, severity}", () => {
  const html = `
<wcs-state json='{"user": {"name": "a"}}'></wcs-state>
<span data-wcs="textContent: user.ghost"></span>
<input data-wcs="value: user.name | badfilter">
`;

  it("aggregator(IDE 経路)と CLI runner が完全一致の診断を出す", () => {
    // IDE 側: plugin は validateDocument をそのまま LSP へ写す。
    const ideDiags = validateDocument(html, { bindAttribute: "data-wcs", stateTagName: "wcs-state" });

    // CI 側: CLI runner も同じ validateDocument を通す。
    const cli = runValidation([{ source: "page.html", text: html, kind: "html" }]);
    const cliDiags = cli.diagnosticsBySource.get("page.html")!;

    // code / range / severity が完全一致(message も同一関数由来なので一致)
    expect(cliDiags).toEqual(ideDiags);
    // 参考: LSP severity への写像も決定的
    expect(ideDiags.map((d) => severityToLsp(d.severity))).toEqual(cliDiags.map((d) => severityToLsp(d.severity)));
    expect(ideDiags.length).toBeGreaterThan(0);
  });
});

describe("外部 state の fileReader 解決（static-wiring-dx-design.md §6-2）", () => {
  const html = `
<wcs-state src="./state.js"></wcs-state>
<span data-wcs="textContent: count"></span>
<span data-wcs="textContent: missingPath"></span>
`;

  it("fileReader なしでは候補ゼロで検証が沈黙する（従来動作の維持）", () => {
    const result = runValidation([{ source: "page.html", text: html, kind: "html" }]);
    const diags = result.diagnosticsBySource.get("page.html")!;
    expect(diags.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing)).toHaveLength(0);
  });

  it("fileReader ありでは外部 .js state を解決しパス実在検証が働く（.ts 優先 → .js フォールバック）", () => {
    const requested: string[] = [];
    const fileReader = (path: string): string | undefined => {
      requested.push(path);
      return path.endsWith("state.js") ? "export default { count: 0 };" : undefined;
    };
    const result = runValidation([{ source: "page.html", text: html, kind: "html", fileReader }]);
    const diags = result.diagnosticsBySource.get("page.html")!;
    const missing = diags.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing);
    expect(missing).toHaveLength(1);
    expect(html.slice(missing[0].start, missing[0].end)).toContain("missingPath");
    // .js の解決は同名 .ts を先に試す（statePathResolver の既存規則）。reader は manifest
    // 発見（wcstack.manifest.json）にも使われるので、state ファイルの要求だけを見る。
    const stateRequests = requested.filter((p) => /state\.(ts|js)$/.test(p));
    expect(stateRequests[0]).toMatch(/state\.ts$/);
    expect(stateRequests[1]).toMatch(/state\.js$/);
  });

  it(".ts と .js が両方読めるとき .ts の内容が勝つこと", () => {
    const fileReader = (path: string): string | undefined => {
      if (path.endsWith("state.ts")) return "export default { tsOnly: 1 };";
      if (path.endsWith("state.js")) return "export default { jsOnly: 1 };";
      return undefined;
    };
    const tsHtml = `
<wcs-state src="./state.js"></wcs-state>
<span data-wcs="textContent: tsOnly"></span>
<span data-wcs="textContent: jsOnly"></span>
`;
    const result = runValidation([{ source: "page.html", text: tsHtml, kind: "html", fileReader }]);
    const missing = result.diagnosticsBySource.get("page.html")!
      .filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing);
    // .ts が正なので jsOnly 側だけが不在警告になる
    expect(missing).toHaveLength(1);
    expect(tsHtml.slice(missing[0].start, missing[0].end)).toContain("jsOnly");
  });

  it("外部 .json state も解決される", () => {
    const jsonHtml = `
<wcs-state src="data/state.json"></wcs-state>
<span data-wcs="textContent: user.name"></span>
<span data-wcs="textContent: user.ghost"></span>
`;
    const fileReader = (path: string): string | undefined =>
      path.endsWith("state.json") ? '{"user": {"name": "a"}}' : undefined;
    const result = runValidation([{ source: "page.html", text: jsonHtml, kind: "html", fileReader }]);
    const diags = result.diagnosticsBySource.get("page.html")!;
    const missing = diags.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing);
    expect(missing).toHaveLength(1);
    expect(jsonHtml.slice(missing[0].start, missing[0].end)).toContain("user.ghost");
  });
});

describe("createFileReader — HTML ファイルのディレクトリ基準で解決", () => {
  it("相対パスを HTML のディレクトリから解決し、読めないパスは undefined を返す", () => {
    const seen: string[] = [];
    const reader = createFileReader("examples/demo/index.html", (path) => {
      seen.push(path);
      if (path.endsWith("state.js")) return "export default { a: 1 };";
      throw new Error("ENOENT");
    });
    expect(reader("./state.js")).toBe("export default { a: 1 };");
    expect(seen[0]).toBe(resolve("examples/demo", "./state.js"));
    expect(reader("missing.json")).toBeUndefined();
  });

  it("URL・protocol-relative・絶対パスは read を呼ばず undefined を返す（ネットワーク/UNC/Webルート遮断）", () => {
    const seen: string[] = [];
    const reader = createFileReader("examples/demo/index.html", (path) => {
      seen.push(path);
      return "should never be read";
    });
    // Windows では resolve(base, "//host/share/x.js") が UNC パス \\host\share\... に
    // 化けて readFileSync が SMB 接続を起こすため、読む前に遮断する。
    expect(reader("//evil.example/share/state.js")).toBeUndefined();
    expect(reader("https://evil.example/state.js")).toBeUndefined();
    expect(reader("HTTPS://evil.example/state.js")).toBeUndefined();
    expect(reader("file://c/state.js")).toBeUndefined();
    // 先頭 `/` はランタイムでは Web ルート基準 = ファイルシステムに写像できない。
    expect(reader("/states/app.json")).toBeUndefined();
    expect(seen).toHaveLength(0);
  });

  it("同じパスの再要求は read を再実行しない（メモ化・成功/失敗とも）", () => {
    const seen: string[] = [];
    const reader = createFileReader("a/index.html", (path) => {
      seen.push(path);
      if (path.endsWith("ok.js")) return "export default {};";
      throw new Error("ENOENT");
    });
    reader("ok.js");
    reader("ok.js");
    reader("missing.js");
    expect(reader("missing.js")).toBeUndefined();
    expect(seen).toHaveLength(2);
  });

  it("UTF-8 BOM を剥がすこと（BOM 付き JSON が黙って候補ゼロになるのを防ぐ）", () => {
    const reader = createFileReader("a/index.html", () => "\uFEFF{\"a\": 1}");
    expect(reader("state.json")).toBe('{"a": 1}');
  });
});

describe("runValidation — CLI core", () => {
  it("HTML と manifest を混在検査し source:line:col を整形する", () => {
    const html = `<wcs-state json='{"a":1}'></wcs-state>\n<span data-wcs="textContent: b"></span>`;
    const manifest = JSON.stringify({ schemaVersion: 1, kind: "package", manifestExtensions: { "wcstack.types": { version: 1, components: { "wcs-x": { inputs: { u: { schema: { type: "string", pattern: "p" } } } } } } } });
    const inputs: CliFileInput[] = [
      { source: "a.html", text: html, kind: "html" },
      { source: "x.manifest.json", text: manifest, kind: "manifest" },
    ];
    const result = runValidation(inputs);

    // HTML: 存在しないパス警告 / manifest: 未知 keyword 警告
    expect(result.warningCount).toBeGreaterThanOrEqual(2);
    expect(result.exitCode).toBe(0); // warning のみ → 0
    // 整形行が source:line:col severity code message 形式
    const htmlLine = result.lines.find((l) => l.startsWith("a.html:"));
    expect(htmlLine).toMatch(/^a\.html:\d+:\d+ warning wcs\/binding-path-missing /);
    const manifestLine = result.lines.find((l) => l.startsWith("x.manifest.json:"));
    expect(manifestLine).toMatch(/^x\.manifest\.json:\d+:\d+ warning wcs\/manifest-unknown-keyword /);
  });

  it("manifest の error(壊れ)は exitCode 1 になる", () => {
    const result = runValidation([{ source: "bad.manifest.json", text: "{ oops", kind: "manifest" }]);
    expect(result.errorCount).toBe(1);
    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toMatch(/^bad\.manifest\.json:\d+:\d+ error wcs\/manifest-broken /);
  });

  it("drift 込みの manifest 集合を検査する", () => {
    const live = new Map<string, LiveBindableDeclaration>([
      ["wcs-fetch", { tag: "wcs-fetch", properties: [{ name: "value", event: "wcs-fetch:response" }], inputs: [], commands: [] }],
    ]);
    const manifest = JSON.stringify({
      schemaVersion: 1, kind: "package",
      manifestExtensions: { "wcstack.types": { version: 1, components: { "wcs-fetch": { observables: { value: { event: "WRONG" } } } } } },
    });
    const result = runValidation([{ source: "f.manifest.json", text: manifest, kind: "manifest" }], { liveDeclarations: live });
    expect(result.errorCount).toBe(1);
    expect(result.lines[0]).toContain(WcsDiagnosticCode.DriftEventMismatch);
  });

  it("診断が無ければ exitCode 0・行なし", () => {
    const html = `<wcs-state json='{"ok":1}'></wcs-state>\n<span data-wcs="textContent: ok"></span>`;
    const result = runValidation([{ source: "clean.html", text: html, kind: "html" }]);
    expect(result.exitCode).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it("errorsOnly: 表示行は error のみに絞るが count / exitCode は全診断で不変", () => {
    // warning(存在しないパス)と error(壊れ manifest)を混在させる。
    const html = `<wcs-state json='{"a":1}'></wcs-state>\n<span data-wcs="textContent: missing"></span>`;
    const inputs: CliFileInput[] = [
      { source: "warn.html", text: html, kind: "html" },
      { source: "bad.manifest.json", text: "{ oops", kind: "manifest" },
    ];

    const full = runValidation(inputs);
    const errorsOnly = runValidation(inputs, { errorsOnly: true });

    // count / exitCode は両者で一致(errorsOnly は表示だけを変える)。
    expect(errorsOnly.errorCount).toBe(full.errorCount);
    expect(errorsOnly.warningCount).toBe(full.warningCount);
    expect(errorsOnly.warningCount).toBeGreaterThan(0);
    expect(errorsOnly.exitCode).toBe(full.exitCode);
    expect(errorsOnly.exitCode).toBe(1);

    // 表示行: errorsOnly では warning 行が消え、error 行のみ残る。
    expect(errorsOnly.lines.some((l) => l.includes(" warning "))).toBe(false);
    expect(errorsOnly.lines.every((l) => l.includes(" error "))).toBe(true);
    expect(errorsOnly.lines.some((l) => l.startsWith("bad.manifest.json:"))).toBe(true);
    // full では warning 行が存在する。
    expect(full.lines.some((l) => l.includes(" warning "))).toBe(true);
  });
});

describe("parseArgs — CLI 引数分解", () => {
  it("--errors-only / --quiet を errorsOnly に、その他フラグと file を分離する", async () => {
    const { parseArgs } = await import("../src/cli.js");
    const a = parseArgs(["--errors-only", "--attr=data-x", "page.html", "x.manifest.json"]);
    expect(a.options.errorsOnly).toBe(true);
    expect(a.options.bindAttribute).toBe("data-x");
    expect(a.files).toEqual(["page.html", "x.manifest.json"]);

    const b = parseArgs(["--quiet", "--state-tag=my-state", "a.html"]);
    expect(b.options.errorsOnly).toBe(true);
    expect(b.options.stateTagName).toBe("my-state");
    expect(b.files).toEqual(["a.html"]);

    // フラグ無しなら errorsOnly は未設定(undefined)。
    const c = parseArgs(["a.html"]);
    expect(c.options.errorsOnly).toBeUndefined();
  });
});

describe("stateSchema（sidecar）の消費 — 発見 / 明示 / IDE-CLI パリティ（D6 / D8）", () => {
  const appManifest = (properties: Record<string, unknown>): string =>
    JSON.stringify({
      schemaVersion: 1,
      kind: "application",
      manifestExtensions: {
        "wcstack.application": { version: 1, states: { default: { stateSchema: { type: "object", properties } } } },
      },
    });
  const manifest = appManifest({
    count: { type: "number" },
    users: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } },
  });
  // 実測 5 の fixture: `[] as {name:string}[]` は正規表現アナライザでは users.*.name が読めない。
  const stateTs = `export default { count: 0, users: [] as { name: string }[] };`;
  const html = `<wcs-state src="./state.ts"></wcs-state>
<p data-wcs="textContent: coutn"></p>
<template data-wcs="for: users"><li data-wcs="textContent: .name"></li></template>
<p>{{ users.length }}</p>
<p>{{ cuont }}</p>`;
  const readerWith = (manifestAt: string | null, text: string = manifest) =>
    (p: string): string | undefined => {
      if (p.endsWith("state.ts")) return stateTs;
      if (manifestAt !== null && p === manifestAt) return text;
      return undefined;
    };

  it("manifest 発見で users.*.name の偽警告が消え、coutn（data-wcs）と cuont（mustache）が error / exit 1", () => {
    const result = runValidation([{ source: "app/index.html", text: html, kind: "html", fileReader: readerWith("wcstack.manifest.json") }]);
    const diags = result.diagnosticsBySource.get("app/index.html")!;
    expect(diags.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing)).toHaveLength(0);
    const nonexistent = diags.filter((d) => d.code === WcsDiagnosticCode.PathNonexistent);
    expect(nonexistent.map((d) => html.slice(d.start, d.end))).toEqual(["coutn", "cuont"]);
    expect(result.errorCount).toBe(2);
    expect(result.exitCode).toBe(1);
    // 発見した manifest の診断は manifest 自身の source（HTML 相対）に載る。壊れていないので空。
    expect(result.diagnosticsBySource.get("app/wcstack.manifest.json")).toEqual([]);
  });

  it("manifest が無ければ従来どおり warning のみ / exit 0（偽警告も残る）", () => {
    const result = runValidation([{ source: "app/index.html", text: html, kind: "html", fileReader: readerWith(null) }]);
    const diags = result.diagnosticsBySource.get("app/index.html")!;
    expect(diags.filter((d) => d.code === WcsDiagnosticCode.PathNonexistent)).toHaveLength(0);
    const missing = diags.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing);
    expect(missing.map((d) => html.slice(d.start, d.end))).toEqual(["coutn", ".name", "cuont"]);
    expect(result.exitCode).toBe(0);
  });

  it("親ディレクトリの manifest も発見され、その source は HTML 相対で表示される", () => {
    const result = runValidation([{ source: "examples/app/index.html", text: html, kind: "html", fileReader: readerWith("../wcstack.manifest.json") }]);
    expect(result.diagnosticsBySource.has("examples/wcstack.manifest.json")).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it("発見した manifest が壊れていれば manifest の source に manifest-broken が載り、HTML は schema 無し扱い", () => {
    const result = runValidation([{ source: "app/index.html", text: html, kind: "html", fileReader: readerWith("wcstack.manifest.json", "{ oops") }]);
    const manifestDiags = result.diagnosticsBySource.get("app/wcstack.manifest.json")!;
    expect(manifestDiags.map((d) => d.code)).toEqual([WcsDiagnosticCode.ManifestBroken]);
    const diags = result.diagnosticsBySource.get("app/index.html")!;
    expect(diags.filter((d) => d.code === WcsDiagnosticCode.PathNonexistent)).toHaveLength(0);
    expect(diags.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing).length).toBeGreaterThan(0);
    // 整形行も manifest 側の source で出る
    expect(result.lines.some((l) => l.startsWith("app/wcstack.manifest.json:"))).toBe(true);
  });

  it("IDE 経路（validateDocument + 同じ reader）と CLI 経路が同一 {code, range, severity} を出す", () => {
    const fileReader = readerWith("wcstack.manifest.json");
    const ide = validateDocument(html, { fileReader });
    const cli = runValidation([{ source: "app/index.html", text: html, kind: "html", fileReader }]).diagnosticsBySource.get("app/index.html")!;
    expect(cli).toEqual(ide);
    expect(ide.some((d) => d.code === WcsDiagnosticCode.PathNonexistent)).toBe(true);
  });

  it("明示引数の application manifest は発見結果を丸ごと置き換える", () => {
    // 発見側は coutn を知らないが、明示側は coutn / cuont を宣言している → error なし
    const explicit = appManifest({ coutn: { type: "number" }, cuont: { type: "number" }, users: { type: "array", items: { type: "object", properties: { name: { type: "string" } } } } });
    const result = runValidation([
      { source: "app/index.html", text: html, kind: "html", fileReader: readerWith("wcstack.manifest.json") },
      { source: "app/other.manifest.json", text: explicit, kind: "manifest" },
    ]);
    const diags = result.diagnosticsBySource.get("app/index.html")!;
    expect(diags.filter((d) => d.code === WcsDiagnosticCode.PathNonexistent)).toHaveLength(0);
    expect(result.diagnosticsBySource.has("app/wcstack.manifest.json")).toBe(false);
  });

  it("明示 application manifest 2 つが同名 state を宣言 → manifest-state-collision（error）で勝者なし → HTML は schema 無し扱い", () => {
    const result = runValidation([
      { source: "app/index.html", text: html, kind: "html", fileReader: readerWith(null) },
      { source: "a.manifest.json", text: manifest, kind: "manifest" },
      { source: "b.manifest.json", text: appManifest({ coutn: { type: "number" } }), kind: "manifest" },
    ]);
    expect(result.diagnosticsBySource.get("b.manifest.json")!.map((d) => d.code)).toContain(WcsDiagnosticCode.ManifestStateCollision);
    const diags = result.diagnosticsBySource.get("app/index.html")!;
    expect(diags.filter((d) => d.code === WcsDiagnosticCode.PathNonexistent)).toHaveLength(0);
    expect(diags.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing).length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(1);
  });

  it("application manifest の stateSchema も subset 規則で検査される（未知 keyword は warning）", () => {
    const withPattern = appManifest({ count: { type: "string", pattern: "x" } });
    const result = runValidation([{ source: "app/index.html", text: html, kind: "html", fileReader: readerWith("wcstack.manifest.json", withPattern) }]);
    const manifestDiags = result.diagnosticsBySource.get("app/wcstack.manifest.json")!;
    expect(manifestDiags.map((d) => d.code)).toContain(WcsDiagnosticCode.ManifestUnknownKeyword);
  });
});
