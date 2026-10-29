/**
 * core/cli/runValidation.ts
 *
 * CI CLI の pure なコア。ファイル入力(HTML / sidecar manifest)を受け取り、
 * IDE と同じ validator core(validateDocument / validateManifestSet)で検査し、
 * `source:line:col severity code message` 形式へ整形する。node I/O は cli.ts が担う。
 *
 * pure(DOM / vscode / node fs 非依存 → テスト可能)。
 */

import { WcsDiagnostic, WcsSeverity, sortDiagnostics } from "../diagnostics.js";
import { createPositionMapper } from "../offsetToPosition.js";
import { validateDocument, ValidateDocumentOptions } from "../validateDocument.js";
import { validateManifestArtifact, validateManifestSet } from "../sidecar/validate.js";
import { discoverApplicationManifest, joinRelativeSource } from "../sidecar/discover.js";
import { JsonSchemaNode, LiveBindableDeclaration } from "../sidecar/types.js";
import type { FileReader } from "../../service/statePathResolver.js";

/** `other`: a framework's component or a script file — not read (see `inputKindOf`). */
export type InputKind = "html" | "manifest" | "other";

/**
 * What the CLI makes of a file it is given, by its name. A framework's components (`.jsx` / `.tsx` / `.vue` /
 * `.svelte`) and script files are not HTML pages: read as one, `<wcs-storage key="…">` in JSX was reported clean
 * although React keeps `key` for itself (docs/seam-apps.md, fw-inventory). They are listed as not read instead.
 * Any other name (`.html`, a server's templates) is read as a page.
 */
export function inputKindOf(path: string): InputKind {
  if (path.endsWith(".manifest.json")) return "manifest";
  return /\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(path) ? "other" : "html";
}

// Whether a page holds anything the rules look at: the binding attribute, a `<wcs-*>` tag or the state tag, a
// wcstack script. A framework app's page (`<div id="root">` and its bundle) holds none, and its clean result
// said "0 error(s)" as if the page had been checked (docs/seam-apps.md, fw-inventory).
function hasAnythingToCheck(text: string, bindAttribute: string, stateTagName: string): boolean {
  return text.includes(bindAttribute) || /<wcs-/i.test(text) || text.includes(`<${stateTagName}`)
    || /@wcstack\/|\bwcstack(?:@[\w.-]+)?\/auto\b/.test(text);
}

export interface CliFileInput {
  readonly source: string;
  readonly text: string;
  readonly kind: InputKind;
  /**
   * この HTML の `<wcs-state src=...>` を解決する reader(HTML ファイルの
   * ディレクトリ基準)。ファイルごとに基準ディレクトリが違うため options でなく
   * 入力側に載せる。manifest 入力では無視。
   */
  readonly fileReader?: FileReader;
  /**
   * The site's root (`--root=<dir>`), where the reader reads a path from `/`: a finding in such a file is reported
   * under it (`<root>/app.js`), not beside the page.
   */
  readonly root?: string;
}

/**
 * fileReader は options でなく CliFileInput 側に載せる(HTML ファイルごとに基準
 * ディレクトリが違うため)。Omit で型レベルでも options 経由の混入を防ぐ。
 */
export interface RunValidationOptions extends Omit<ValidateDocumentOptions, "fileReader"> {
  readonly liveDeclarations?: ReadonlyMap<string, LiveBindableDeclaration>;
  /**
   * true なら整形行(`lines`)に error severity の診断だけを載せる(warning / info は省く)。
   * `errorCount` / `warningCount` / `infoCount` と `exitCode` は全診断で不変。
   * CI ゲートで大量の false-positive warning(fileReader でも解決できない外部 state の
   * パス等)を出力から除き、build を落とす error だけを表示するために使う。
   */
  readonly errorsOnly?: boolean;
  /**
   * true なら warning severity でも `exitCode` を 1 にする(`--strict`)。
   * severity 自体は動かさない — 診断の {code, range, severity} は IDE と同じまま、
   * exit code の判定閾値だけを error → warning に下げる別軸のスイッチ。
   * `errorsOnly` とは独立(併用時: 表示は error のみ・exit は warning でも 1)。
   * 主用途は「`wcs/binding-path-missing`(typo)で CI を落とす」。
   */
  readonly strict?: boolean;
}

export interface RunValidationResult {
  /** ソート済みの整形行(source:line:col severity code message)。 */
  readonly lines: readonly string[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  /** exit code(error があれば 1。`strict` なら warning でも 1。それ以外 0)。 */
  readonly exitCode: 0 | 1;
  /** file source → 診断(テスト用)。 */
  readonly diagnosticsBySource: ReadonlyMap<string, readonly WcsDiagnostic[]>;
  /** The files not read (`other`), in the order given. */
  readonly notRead: readonly string[];
  /** The pages read with nothing to check in them, in the order given. */
  readonly nothingToCheck: readonly string[];
  /**
   * The lines to print after the counts, `--errors-only` or not: which files were not read and which had nothing
   * to check, so a clean result over them is not taken for a checked app. Empty when every file was checked.
   */
  readonly notes: readonly string[];
}

const severityLabel: Record<WcsSeverity, string> = { error: "error", warning: "warning", info: "info" };

export function runValidation(inputs: readonly CliFileInput[], options: RunValidationOptions = {}): RunValidationResult {
  const diagnosticsBySource = new Map<string, readonly WcsDiagnostic[]>();
  const textBySource = new Map(inputs.map((i) => [i.source, i.text]));

  // manifest(明示引数): 全 manifest をまとめて集合検証(衝突/override/drift は cross-artifact)。
  // application artifact が含まれていれば、その解決済み stateSchema が HTML 検証の契約になり、
  // 最近傍発見(D8)は行わない — 明示指定が発見結果を丸ごと置き換える。
  const manifestInputs = inputs.filter((i) => i.kind === "manifest");
  let explicitSchema: JsonSchemaNode | undefined;
  let haveExplicitApplication = false;
  if (manifestInputs.length > 0) {
    const result = validateManifestSet({
      artifacts: manifestInputs.map((m) => ({ text: m.text, source: m.source })),
      liveDeclarations: options.liveDeclarations,
    });
    for (const input of manifestInputs) {
      diagnosticsBySource.set(input.source, result.byArtifact.get(input.source) ?? []);
    }
    if (result.hasApplicationArtifact) {
      haveExplicitApplication = true;
      explicitSchema = result.resolvedSchema;
    }
  }

  // HTML: ファイルごとに validateDocument。明示 application manifest が無ければ、HTML の
  // 位置から最近傍の wcstack.manifest.json を発見して契約にする(IDE と同じ discover)。
  // 発見した manifest 自身の診断(envelope / schema subset)は HTML の source に混ぜず、
  // manifest の source(HTML 相対で表示)に載せる。同じ manifest を複数の HTML が発見しても
  // 検証は 1 回。
  /** Findings in the state files the pages load with `src=`, by source (see below). */
  const inFiles = new Map<string, WcsDiagnostic[]>();
  const nothingToCheck: string[] = [];
  for (const input of inputs) {
    if (input.kind !== "html") continue;
    if (!hasAnythingToCheck(input.text, options.bindAttribute ?? "data-wcs", options.stateTagName ?? "wcs-state")) {
      nothingToCheck.push(input.source);
    }
    let applicationSchema = explicitSchema;
    if (!haveExplicitApplication && input.fileReader !== undefined) {
      const discovered = discoverApplicationManifest(input.fileReader);
      applicationSchema = discovered?.schema;
      if (discovered !== undefined) {
        const source = joinRelativeSource(input.source, discovered.relativePath);
        if (!diagnosticsBySource.has(source)) {
          textBySource.set(source, discovered.text);
          diagnosticsBySource.set(source, validateManifestArtifact({ text: discovered.text, source }));
        }
      }
    }
    const docOptions: ValidateDocumentOptions = {
      ...options,
      ...(input.fileReader !== undefined ? { fileReader: input.fileReader } : {}),
      ...(applicationSchema !== undefined ? { applicationSchema } : {}),
    };
    const own: WcsDiagnostic[] = [];
    for (const d of validateDocument(input.text, docOptions)) {
      if (d.origin === undefined) {
        own.push(d);
        continue;
      }
      // A finding in a state file the page loads with `src=` is reported in that file (once, however many pages
      // load it); the IDE shows it on the page's `src` value
      const source = d.origin.path.startsWith("/") && input.root !== undefined
        ? joinRelativeSource(`${input.root}/_`, `.${d.origin.path}`)
        : joinRelativeSource(input.source, d.origin.path);
      if (!textBySource.has(source)) textBySource.set(source, input.fileReader?.(d.origin.path) ?? "");
      let list = inFiles.get(source);
      if (list === undefined) inFiles.set(source, (list = []));
      const { origin, ...rest } = d;
      if (!list.some((x) => x.code === d.code && x.start === origin.start && x.end === origin.end && x.message === d.message)) {
        list.push({ ...rest, start: origin.start, end: origin.end });
      }
    }
    diagnosticsBySource.set(input.source, own);
  }
  for (const [source, list] of inFiles) diagnosticsBySource.set(source, sortDiagnostics(list));
  const lines: string[] = [];
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  // ファイルは source 昇順、診断は各ファイル内で start 昇順(validate 側で sort 済み)。
  for (const source of [...diagnosticsBySource.keys()].sort()) {
    const diags = diagnosticsBySource.get(source)!;
    const mapper = createPositionMapper(textBySource.get(source) ?? "");
    for (const d of diags) {
      if (d.severity === "error") errorCount++;
      else if (d.severity === "warning") warningCount++;
      else infoCount++;
      // counts は全診断で数え、errorsOnly 時は表示行だけ error に絞る。
      if (options.errorsOnly && d.severity !== "error") continue;
      const pos = mapper(d.start);
      lines.push(`${source}:${pos.line}:${pos.column} ${severityLabel[d.severity]} ${d.code} ${d.message}`);
    }
  }

  const notRead = inputs.filter((i) => i.kind === "other").map((i) => i.source);
  const notes: string[] = [];
  if (notRead.length > 0) {
    notes.push(`not read: ${notRead.join(", ")} — wcs-validate reads HTML pages (data-wcs, <wcs-*> tags), not a framework's components or script files`);
  }
  if (nothingToCheck.length > 0) {
    notes.push(`nothing to check: ${nothingToCheck.join(", ")} — no data-wcs binding, <wcs-*> tag or wcstack script in them`);
  }

  return {
    lines,
    errorCount,
    warningCount,
    infoCount,
    exitCode: errorCount > 0 || (options.strict === true && warningCount > 0) ? 1 : 0,
    diagnosticsBySource,
    notRead,
    nothingToCheck,
    notes,
  };
}
