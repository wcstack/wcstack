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

import { BUILTIN_FILTERS } from "./completionData.js";
import { getStatePathsFromHtml, type FileReader } from "./statePathResolver.js";
import { mergeSchemaCandidates } from "./stateAnalyzer.js";
import { findAllCommentBindings, findAllMustacheSyntax } from "./templateSyntax.js";
import { isInsideForTemplate, getInnermostForPath, getAvailableWildcardRank, countWildcardSegments } from "./forContext.js";
import { WcsDiagnosticCode, type WcsDiagnosticCodeValue } from "../core/diagnostics.js";
import { getMessages } from "../core/messages.js";
import { resolveSchemaPath } from "../core/sidecar/schemaSubset.js";
import type { JsonSchemaNode } from "../core/sidecar/types.js";
import type { BindingDiagnostic } from "./bindingValidator.js";

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
    scoped: { path: string }[],
  ): { code: WcsDiagnosticCodeValue; severity: "error" | "warning"; message: string } | null => {
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
    let pathPart = (parts[0] || "").trim();

    const atIdx = pathPart.indexOf("@");
    if (atIdx !== -1) pathPart = pathPart.slice(0, atIdx).trim();

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
      if (insideFor && !pathPart.startsWith(".") && !pathPart.includes("@")) {
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

    for (let i = 1; i < parts.length; i++) {
      const filterName = parts[i].trim().replace(/\(.*$/, "");
      if (filterName && !filterNameSet.has(filterName)) {
        const filterOffset = item.expression.indexOf(parts[i]);
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
  scopedPaths: { path: string }[],
): boolean {
  if (/^\$\d+$/.test(path)) return true;
  if (path.startsWith("$streamStatus.") || path.startsWith("$streamError.")) {
    const prefix = path.startsWith("$streamStatus.") ? "$streamStatus." : "$streamError.";
    const hasNamespace = scopedPaths.some((p) => p.path.startsWith(prefix));
    return !hasNamespace || pathSet.has(path);
  }
  return pathSet.has(path);
}
