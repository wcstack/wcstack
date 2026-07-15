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
import { validateManifestSet } from "../sidecar/validate.js";
import { LiveBindableDeclaration } from "../sidecar/types.js";

export type InputKind = "html" | "manifest";

export interface CliFileInput {
  readonly source: string;
  readonly text: string;
  readonly kind: InputKind;
}

export interface RunValidationOptions extends ValidateDocumentOptions {
  readonly liveDeclarations?: ReadonlyMap<string, LiveBindableDeclaration>;
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

  // HTML: ファイルごとに validateDocument。
  for (const input of inputs) {
    if (input.kind === "html") {
      diagnosticsBySource.set(input.source, validateDocument(input.text, options));
    }
  }

  // manifest: 全 manifest をまとめて集合検証(衝突/override/drift は cross-artifact)。
  const manifestInputs = inputs.filter((i) => i.kind === "manifest");
  if (manifestInputs.length > 0) {
    const result = validateManifestSet({
      artifacts: manifestInputs.map((m) => ({ text: m.text, source: m.source })),
      liveDeclarations: options.liveDeclarations,
    });
    for (const input of manifestInputs) {
      diagnosticsBySource.set(input.source, result.byArtifact.get(input.source) ?? []);
    }
  }

  const textBySource = new Map(inputs.map((i) => [i.source, i.text]));
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
