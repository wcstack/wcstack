/**
 * templateSyntaxValidator.ts
 *
 * Mustache `{{ path }}` / コメントバインディング `<!--@@:path-->` の診断。
 * 旧 wcsCompletionPlugin 内のローカル関数を pure module として切り出したもの
 * (Phase 5a §7.1: validator core は IDE / CI / dev runtime で共有)。診断は
 * 安定した code を持つ。
 *
 * pure(DOM / vscode 非依存)。
 */

import { BUILTIN_FILTERS, canonicalFilterName } from "./completionData.js";
import { getStatePathsFromHtml, type FileReader } from "./statePathResolver.js";
import { mergeSchemaCandidates, type PathCandidate } from "./stateAnalyzer.js";
import { findAllCommentBindings, findAllMustacheSyntax } from "./templateSyntax.js";
import { isInsideForTemplate, getInnermostForPath, getAvailableWildcardRank, countWildcardSegments } from "./forContext.js";
import { WcsDiagnosticCode, type WcsDiagnosticCodeValue } from "../core/diagnostics.js";
import { getMessages } from "../core/messages.js";
import { resolveSchemaPath } from "../core/sidecar/schemaSubset.js";
import type { JsonSchemaNode } from "../core/sidecar/types.js";
import { matchesRecursionCandidates, type BindingDiagnostic } from "./bindingValidator.js";
import { hasRecursionWildcard } from "./recursionPaths.js";

export function validateTemplateSyntax(
  html: string,
  stateTagName: string,
  bindAttrName: string = "data-wcs",
  locale?: string,
  fileReader?: FileReader,
  applicationSchema?: JsonSchemaNode,
): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];
  const msgs = getMessages(locale);

  // schema 由来の候補も合流させる（bindingValidator と同じ規則・D12）。mustache は
  // default state のみを検証するので、存在判定の三値化も default の schema に対して行う。
  const allPaths = mergeSchemaCandidates(getStatePathsFromHtml(html, stateTagName, fileReader), applicationSchema);
  const defaultSchema = applicationSchema;
  /** 存在しなければ code / severity / message を返す（stateSchema 宣言時は三値判定）。 */
  const missingVerdict = (
    path: string,
    displayPath: string,
    pathSet: Set<string>,
    scoped: readonly PathCandidate[],
  ): { code: WcsDiagnosticCodeValue; severity: "error" | "warning"; message: string } | null => {
    // `**` はオーサリング層だけの記号。mustache / コメントバインディングでも
    // ランタイムは PathInfo の不変条件として throw する（bindingValidator と同条件）。
    if (hasRecursionWildcard(path)) {
      return {
        code: WcsDiagnosticCode.RecursionUnsupported,
        severity: "error",
        message: msgs.recursionUnsupported(path, "binding"),
      };
    }
    if (isValidTemplatePath(path, pathSet, scoped)) return null;
    if (defaultSchema !== undefined && !path.startsWith("$")) {
      const resolution = resolveSchemaPath(defaultSchema, defaultSchema.$defs ?? {}, path.split("."));
      return resolution.kind === "nonexistent"
        ? { code: WcsDiagnosticCode.PathNonexistent, severity: "error", message: msgs.pathNonexistent(displayPath) }
        : null;
    }
    return { code: WcsDiagnosticCode.BindingPathMissing, severity: "warning", message: msgs.pathMissing(displayPath) };
  };
  if (allPaths.length === 0) return diagnostics;

  const defaultPaths = allPaths;
  const pathSet = new Set(defaultPaths.map((p) => p.path));
  const filterNameSet = new Set(BUILTIN_FILTERS.map((f) => f.name));

  const mustaches = findAllMustacheSyntax(html);
  const comments = findAllCommentBindings(html);

  for (const item of [...mustaches, ...comments]) {
    if (item.kind === "comment") {
      diagnostics.push({
        code: WcsDiagnosticCode.TemplateSyntax,
        start: item.matchStart,
        end: item.matchEnd,
        message: msgs.wcsTextInfo(item.expression),
        severity: "info",
      });
    }

    if (item.kind === "mustache" && !item.insideTemplate) {
      diagnostics.push({
        code: WcsDiagnosticCode.TemplateSyntax,
        start: item.matchStart,
        end: item.matchEnd,
        message: msgs.moustacheFouc(item.expression),
        severity: "info",
      });
    }

    if (!item.expression) continue;

    const parts = item.expression.split("|");
    const pathPart = (parts[0] || "").trim();

    // `path@name`（名前付き State セレクタ）は v2 で撤去 — runtime では parse error。
    // namedStateValidator が同位置へ error を出すので、ここで `@` 前を strip して
    // 受理すると診断が二重になる上、存在しないパスとして誤報しうる — 検証しない
    if (pathPart.includes("@")) continue;

    const insideFor = item.insideTemplate && isInsideForTemplate(html, item.matchStart, bindAttrName);

    if (pathPart && !/^-?\d|^["'`]|^true$|^false$|^null$/.test(pathPart)) {
      if (!insideFor && pathPart.includes("*")) {
        diagnostics.push({
          code: WcsDiagnosticCode.TemplateSyntax,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.patternPathOutsideFor(pathPart),
          severity: "warning",
        });
      }
      if (!insideFor && pathPart.startsWith(".")) {
        diagnostics.push({
          code: WcsDiagnosticCode.TemplateSyntax,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.omittedPathOutsideFor(pathPart),
          severity: "warning",
        });
      }
      // for の**段数**を超える階数（`matrix.*.*` / `$2`）。上の 2 つは「for の外か」の
      // 二値しか見ておらず、深さ方向は未検査だった。available === 0 は上が担う。
      //（`@` 入りの式は上で continue 済み）
      if (insideFor && !pathPart.startsWith(".")) {
        const indexMatch = /^\$(\d+)$/.exec(pathPart);
        const needed = indexMatch !== null
          ? Number(indexMatch[1])
          : (pathPart.includes("*") ? countWildcardSegments(pathPart) : 0);
        if (needed > 0) {
          const available = getAvailableWildcardRank(html, item.matchStart, bindAttrName);
          if (available > 0 && needed > available) {
            diagnostics.push({
              code: WcsDiagnosticCode.WildcardRank,
              start: item.exprStart,
              end: item.exprStart + pathPart.length,
              message: msgs.wildcardRank(`"${pathPart}"`, needed, available),
              severity: "warning",
            });
          }
        }
      }

      if (/\.\d+\.|\.\d+$/.test(pathPart)) {
        diagnostics.push({
          code: WcsDiagnosticCode.TemplateSyntax,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.resolvedPathInUi(pathPart),
          severity: "warning",
        });
      }

      if (pathPart.startsWith(".")) {
        const forPath = insideFor ? getInnermostForPath(html, item.matchStart, bindAttrName) : null;
        if (forPath && !forPath.startsWith(".")) {
          // 単独の `.` は行そのもの＝`<forPath>.*`（末尾に区切りは付かない）。
          // ランタイム: state/src/structural/expandShorthandPaths.ts
          const expandedPath = pathPart === "."
            ? `${forPath}.*`
            : `${forPath}.*.${pathPart.slice(1)}`;
          const verdict = missingVerdict(expandedPath, pathPart, pathSet, defaultPaths);
          if (verdict) {
            diagnostics.push({
              code: verdict.code,
              start: item.exprStart,
              end: item.exprStart + pathPart.length,
              message: verdict.message + msgs.expansionSuffix(expandedPath),
              severity: verdict.severity,
            });
          }
        }
      } else {
        const verdict = missingVerdict(pathPart, pathPart, pathSet, defaultPaths);
        if (verdict) {
          diagnostics.push({
            code: verdict.code,
            start: item.exprStart,
            end: item.exprStart + pathPart.length,
            message: verdict.message,
            severity: verdict.severity,
          });
        }
      }
    }

    // 区間の開始は**積算**で持つ（`indexOf` だと同じフィルタを 2 回書いたとき
    // `{{ name | uc | uc }}` の 2 件目も 1 個目の位置を指してしまう）。
    let segmentStart = parts[0].length + 1; // parts[0] ＋ 区切りの `|`
    for (let i = 1; i < parts.length; i++) {
      const segment = parts[i];
      const filterName = segment.trim().replace(/\(.*$/, "");
      // 範囲は名前の先頭から（区切りの `|` の後の空白を含めない）
      const filterOffset = segmentStart + (segment.length - segment.trimStart().length);
      segmentStart += segment.length + 1;
      const canonical = canonicalFilterName(filterName);
      if (filterName && canonical !== filterName && filterNameSet.has(canonical)) {
        // 旧名（3.x のエイリアス）は動く — info で正式名を提案する（要件 B12）
        diagnostics.push({
          code: WcsDiagnosticCode.NameAlias,
          start: item.exprStart + filterOffset,
          end: item.exprStart + filterOffset + filterName.length,
          message: msgs.nameAlias(filterName, canonical),
          severity: "info",
        });
      } else if (filterName && !filterNameSet.has(filterName)) {
        diagnostics.push({
          code: WcsDiagnosticCode.FilterUnknown,
          start: item.exprStart + filterOffset,
          end: item.exprStart + filterOffset + filterName.length,
          message: msgs.filterUnknown(filterName),
          severity: "warning",
        });
      }
    }
  }

  return diagnostics;
}

function isValidTemplatePath(
  path: string,
  pathSet: Set<string>,
  scopedPaths: readonly PathCandidate[],
): boolean {
  if (/^\$\d+$/.test(path)) return true;
  if (path.startsWith("$streamStatus.") || path.startsWith("$streamError.")) {
    const prefix = path.startsWith("$streamStatus.") ? "$streamStatus." : "$streamError.";
    const hasNamespace = scopedPaths.some((p) => p.path.startsWith(prefix));
    return !hasNamespace || pathSet.has(path);
  }
  // `$recursion` 宣言済みの木の展開形（深さを畳んでから候補集合に当てる）。
  // bindingValidator の validatePathExistence と同じ規則。
  return pathSet.has(path) || matchesRecursionCandidates(scopedPaths, path, pathSet);
}
