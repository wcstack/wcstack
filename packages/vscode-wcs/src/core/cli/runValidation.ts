/**
 * core/cli/runValidation.ts
 *
 * CI CLI の pure なコア。ファイル入力(HTML / sidecar manifest)を受け取り、
 * IDE と同じ validator core(validateDocument / validateManifestSet)で検査し、
 * `source:line:col severity code message` 形式へ整形する。node I/O は cli.ts が担う。
 *
 * pure(DOM / vscode / node fs 非依存 → テスト可能)。
 */

import { WcsDiagnostic, WcsSeverity } from "../diagnostics.js";
import { createPositionMapper } from "../offsetToPosition.js";
import { validateDocument, ValidateDocumentOptions } from "../validateDocument.js";
import { validateManifestArtifact, validateManifestSet } from "../sidecar/validate.js";
import { discoverApplicationManifest, joinRelativeSource } from "../sidecar/discover.js";
import { JsonSchemaNode, LiveBindableDeclaration } from "../sidecar/types.js";
import type { FileReader } from "../../service/statePathResolver.js";

export type InputKind = "html" | "manifest";

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
}

export interface RunValidationResult {
  /** ソート済みの整形行(source:line:col severity code message)。 */
  readonly lines: readonly string[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  /** exit code(error があれば 1、なければ 0)。 */
  readonly exitCode: 0 | 1;
  /** file source → 診断(テスト用)。 */
  readonly diagnosticsBySource: ReadonlyMap<string, readonly WcsDiagnostic[]>;
}

const severityLabel: Record<WcsSeverity, string> = { error: "error", warning: "warning", info: "info" };

export function runValidation(inputs: readonly CliFileInput[], options: RunValidationOptions = {}): RunValidationResult {
  const diagnosticsBySource = new Map<string, readonly WcsDiagnostic[]>();
  const textBySource = new Map(inputs.map((i) => [i.source, i.text]));

  // manifest(明示引数): 全 manifest をまとめて集合検証(衝突/override/drift は cross-artifact)。
  // application artifact が含まれていれば、その解決済み stateSchema が HTML 検証の契約になり、
  // 最近傍発見(D8)は行わない — 明示指定が発見結果を丸ごと置き換える。
  const manifestInputs = inputs.filter((i) => i.kind === "manifest");
  let explicitStates: ReadonlyMap<string, JsonSchemaNode> | undefined;
  if (manifestInputs.length > 0) {
    const result = validateManifestSet({
      artifacts: manifestInputs.map((m) => ({ text: m.text, source: m.source })),
      liveDeclarations: options.liveDeclarations,
    });
    for (const input of manifestInputs) {
      diagnosticsBySource.set(input.source, result.byArtifact.get(input.source) ?? []);
    }
    if (result.hasApplicationArtifact) explicitStates = result.resolvedStates;
  }

  // HTML: ファイルごとに validateDocument。明示 application manifest が無ければ、HTML の
  // 位置から最近傍の wcstack.manifest.json を発見して契約にする(IDE と同じ discover)。
  // 発見した manifest 自身の診断(envelope / schema subset)は HTML の source に混ぜず、
  // manifest の source(HTML 相対で表示)に載せる。同じ manifest を複数の HTML が発見しても
  // 検証は 1 回。
  for (const input of inputs) {
    if (input.kind !== "html") continue;
    let applicationStates = explicitStates;
    if (applicationStates === undefined && input.fileReader !== undefined) {
      const discovered = discoverApplicationManifest(input.fileReader);
      applicationStates = discovered?.states ?? new Map();
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
      ...(applicationStates !== undefined ? { applicationStates } : {}),
    };
    diagnosticsBySource.set(input.source, validateDocument(input.text, docOptions));
  }
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

  return {
    lines,
    errorCount,
    warningCount,
    infoCount,
    exitCode: errorCount > 0 ? 1 : 0,
    diagnosticsBySource,
  };
}
