/**
 * fileReader.test.ts
 *
 * 外部 state（`<wcs-state src=...>`）の reader が **IDE と CLI の両方**に配線されて
 * いることを固定する。以前は CLI にしか無く、外部 state のページは IDE 側で
 * 「候補ゼロ → パス検証は沈黙」に落ちていた（ADR-09 §7.1 のパリティ破れ）。
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createFileReaderForUri } from "../src/fileReader.js";
import { validateDocument } from "../src/core/validateDocument.js";
import { WcsDiagnosticCode } from "../src/core/diagnostics.js";

describe("createFileReaderForUri", () => {
  it("file: URI を HTML のディレクトリ基準の reader にすること", () => {
    const seen: string[] = [];
    const uri = pathToFileURL(resolve("examples/demo/index.html")).href;
    const reader = createFileReaderForUri(uri, (path) => {
      seen.push(path);
      return "export default { a: 1 };";
    })!;

    expect(reader("./state.js")).toBe("export default { a: 1 };");
    expect(seen[0]).toBe(resolve("examples/demo", "./state.js"));
  });

  it("file: 以外のスキームでは undefined を返すこと（従来どおり沈黙に縮退）", () => {
    // 未保存バッファ・仮想 FS にはローカルパスが無い。無理に読むと無関係な
    // ファイルを掴むので読まない。
    expect(createFileReaderForUri("untitled:Untitled-1")).toBeUndefined();
    expect(createFileReaderForUri("vscode-vfs://github/owner/repo/index.html")).toBeUndefined();
    expect(createFileReaderForUri("https://example.com/index.html")).toBeUndefined();
  });

  it("パスに写像できない file: URI では throw せず undefined を返すこと", () => {
    // エンコードされた `/` を含む file: URI は fileURLToPath が throw する。
    // 診断プロバイダの中で throw すると LSP のリクエストごと落ちるので握る。
    expect(createFileReaderForUri("file:///C:/a%2Fb/index.html")).toBeUndefined();
  });

  it("host 付き file: URI の扱いはプラットフォーム依存だが、どちらでも throw しないこと", () => {
    // `file://host/share/...` は **Node の挙動が OS で割れる**:
    //   Windows → UNC パス `\\host\share\...` に写像される（reader を作る）
    //   POSIX   → localhost 以外の host は ERR_INVALID_FILE_URL_HOST で throw
    // 契約はプラットフォーム不変な方（「throw せず reader か undefined を返す」）に
    // 置く。Windows で reader を作るのは、そこが開いている文書自身の場所であり
    // エディタが既に読んでいる共有だから（新しいネットワークアクセスを増やさない）。
    // CLI が**相対パス** `//host/...` を拒否するのとは別の話。
    let result: unknown;
    expect(() => { result = createFileReaderForUri("file://remote-host/share/index.html", () => "x"); }).not.toThrow();
    if (process.platform === "win32") {
      expect(result).toBeTypeOf("function");
    } else {
      expect(result).toBeUndefined();
    }
  });
});

describe("外部 state のパス検証（IDE / CLI パリティ）", () => {
  const HTML = `
    <wcs-state src="./state.js"></wcs-state>
    <span data-wcs="textContent: user.nmae"></span>
  `;
  const STATE_JS = `export default { user: { name: "Ann" } };`;

  function readerFor(files: Record<string, string>) {
    const uri = pathToFileURL(resolve("fixture/index.html")).href;
    return createFileReaderForUri(uri, (path) => {
      const key = path.replace(/\\/g, "/").split("/").pop()!;
      const content = files[key];
      if (content === undefined) throw new Error("ENOENT");
      return content;
    })!;
  }

  it("reader を渡せば外部 state のパスも検証されること", () => {
    const diagnostics = validateDocument(HTML, { fileReader: readerFor({ "state.js": STATE_JS }) });
    const pathMissing = diagnostics.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing);
    expect(pathMissing).toHaveLength(1);
    expect(HTML.slice(pathMissing[0].start, pathMissing[0].end)).toBe("user.nmae");
  });

  it("reader を渡さないと沈黙すること（配線前の挙動 ＝ 退行検出の対照）", () => {
    const diagnostics = validateDocument(HTML);
    expect(diagnostics.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing)).toHaveLength(0);
  });

  it("外部ファイルが読めないときは沈黙すること（候補ゼロの保守側に倒れる）", () => {
    const diagnostics = validateDocument(HTML, { fileReader: readerFor({}) });
    expect(diagnostics.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing)).toHaveLength(0);
  });

  it("正しいパスなら診断は出ないこと", () => {
    const html = HTML.replace("user.nmae", "user.name");
    const diagnostics = validateDocument(html, { fileReader: readerFor({ "state.js": STATE_JS }) });
    expect(diagnostics.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing)).toHaveLength(0);
  });
});
