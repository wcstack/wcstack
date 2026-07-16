import { describe, it, expect } from "vitest";
import { createPositionMapper } from "../src/core/offsetToPosition.js";
import { validateDocument } from "../src/core/validateDocument.js";
import { runValidation, type CliFileInput } from "../src/core/cli/runValidation.js";
import { WcsDiagnosticCode, severityToLsp } from "../src/core/diagnostics.js";
import type { LiveBindableDeclaration } from "../src/core/sidecar/types.js";

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
