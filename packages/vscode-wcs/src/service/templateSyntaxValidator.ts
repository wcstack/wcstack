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
import { getStatePathIndex, isUnresolvedPath, type FileReader } from "./statePathResolver.js";
import { mergeSchemaCandidates, type PathCandidate } from "./stateAnalyzer.js";
import { findAllCommentBindings, findAllMustacheSyntax } from "./templateSyntax.js";
import { splitOutsideQuotes } from "../core/parser/quoteAware.js";
import {
  isInsideForTemplate, getRowShorthandForPath, countWildcardSegments, getResolvedForListPath, rankOfForList, findOtherListWildcard,
} from "./forContext.js";
import { WcsDiagnosticCode, type WcsDiagnosticCodeValue } from "../core/diagnostics.js";
import { getMessages } from "../core/messages.js";
import type { JsonSchemaNode } from "../core/sidecar/types.js";
import { pathExistsInCandidates, resolveIndexedSchemaPath, type BindingDiagnostic } from "./bindingValidator.js";
import { hasRecursionWildcard } from "./recursionPaths.js";
import { removedFilterMessage } from "./removedNames.js";
import { classifyIndexParam, hasUnsafeSegment, MAX_INDEX_PARAM } from "./indexPath.js";

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
  // Without a stateSchema, nothing is said about a path in a state the validator could not read (as in bindingValidator)
  const pathIndex = getStatePathIndex(html, stateTagName, fileReader);
  const allPaths = mergeSchemaCandidates(pathIndex.paths, applicationSchema);
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
    // 正本パーサが #120 で拒むパスは `wcs/binding-syntax` が報告する（存在の検査を重ねない）
    if (hasUnsafeSegment(path)) return null;
    if (isValidTemplatePath(path, pathSet, scoped)) return null;
    if (defaultSchema !== undefined && !path.startsWith("$")) {
      const resolution = resolveIndexedSchemaPath(defaultSchema, path);
      return resolution.kind === "nonexistent"
        ? { code: WcsDiagnosticCode.PathNonexistent, severity: "error", message: msgs.pathNonexistent(displayPath) }
        : null;
    }
    if (isUnresolvedPath(path, pathIndex.scopes)) return null;
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

    // フィルタの区切りは**引用符の外**の `|` だけ（要件 B1 — ランタイムの
    // `splitOutsideQuotes`）。素の `split("|")` だと `{{ items|join('|') }}` の引数が
    // 割れ、後片（`')`）を未知フィルタと見て `wcs/filter-unknown` を誤報する。
    const parts = splitOutsideQuotes(item.expression, "|");
    const pathPart = (parts[0] || "").trim();

    // `path@name`（名前付き State セレクタ）は v2 で撤去 — runtime では parse error。
    // namedStateValidator が同位置へ error を出すので、ここで `@` 前を strip して
    // 受理すると診断が二重になる上、存在しないパスとして誤報しうる — 検証しない
    if (pathPart.includes("@")) continue;

    const insideFor = item.insideTemplate && isInsideForTemplate(html, item.matchStart, bindAttrName);

    if (pathPart && !/^-?\d|^["'`]|^true$|^false$|^null$/.test(pathPart)) {
      // for の外のパターンパス・省略パス・ループの添字は、ランタイムと同じ `wcs/wildcard-rank`（#1401 / #1402。
      // 重大度は bindingValidator と同じく warning）
      if (!insideFor && pathPart.includes("*")) {
        diagnostics.push({
          code: WcsDiagnosticCode.WildcardRank,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.patternPathOutsideFor(pathPart),
          severity: "warning",
        });
      }
      if (!insideFor && pathPart.startsWith(".")) {
        diagnostics.push({
          code: WcsDiagnosticCode.WildcardRank,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.omittedPathOutsideFor(pathPart),
          severity: "warning",
        });
      }
      const outsideIndex = insideFor ? null : classifyIndexParam(pathPart);
      if (outsideIndex !== null && outsideIndex.kind !== "notIndex") {
        diagnostics.push({
          code: WcsDiagnosticCode.WildcardRank,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.loopIndexOutsideFor(pathPart),
          severity: "warning",
        });
      }
      // `$` ＋数字だけのパス（bindingValidator と同じ規則）: `$0` / `$01` / `$1000` は添字でもパスでもない
      // （ランタイムは `[wcs/binding-path-missing]` で失敗させる）、for の中の `$129` は `[wcs/index-param-range]`
      const indexParam = classifyIndexParam(pathPart);
      if (indexParam !== null && indexParam.kind === "notIndex") {
        diagnostics.push({
          code: WcsDiagnosticCode.BindingPathMissing,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.indexParamNotPath(pathPart, MAX_INDEX_PARAM),
          severity: "error",
        });
      } else if (insideFor && indexParam !== null && indexParam.kind === "range") {
        diagnostics.push({
          code: WcsDiagnosticCode.IndexParamRange,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.indexParamRange(pathPart, MAX_INDEX_PARAM),
          severity: "error",
        });
      }
      // for の**段数**を超える階数（`matrix.*.*` / `$2`）。上の 2 つは「for の外か」の
      // 二値しか見ておらず、深さ方向は未検査だった。available === 0 は上が担う。
      //（`@` 入りの式は上で continue 済み）
      if (insideFor && !pathPart.startsWith(".")) {
        const indexMatch = indexParam !== null && indexParam.kind === "index" ? indexParam : null;
        const needed = indexMatch !== null
          ? indexMatch.n
          : (indexParam === null && pathPart.includes("*") ? countWildcardSegments(pathPart) : 0);
        if (needed > 0) {
          const resolvedList = getResolvedForListPath(html, item.matchStart, bindAttrName);
          const available = resolvedList === null ? 0 : rankOfForList(resolvedList);
          if (available > 0 && needed > available) {
            diagnostics.push({
              code: WcsDiagnosticCode.WildcardRank,
              start: item.exprStart,
              end: item.exprStart + pathPart.length,
              message: msgs.wildcardRank(`"${pathPart}"`, needed, available),
              severity: "warning",
            });
          } else if (indexMatch === null && resolvedList !== null) {
            // 各段の `*` は**その段で囲む for のリスト**の行（4.0 の F32・#1403）。bindingValidator と同じ規則
            const other = findOtherListWildcard(pathPart, resolvedList);
            if (other !== null) {
              diagnostics.push({
                code: WcsDiagnosticCode.WildcardRank,
                start: item.exprStart,
                end: item.exprStart + pathPart.length,
                message: msgs.wildcardOtherList(pathPart, other.over, other.loop),
                severity: "warning",
              });
            }
          }
        }
      }
      // 数値の添字のパス（`{{ items.0.name }}`）は警告しない — 4.0 は添字の数によらず追従する（F17・#355・#383）

      if (pathPart.startsWith(".")) {
        // Not under a for the parser refuses (getRowShorthandForPath — those rows never exist)
        const forPath = insideFor ? getRowShorthandForPath(html, item.matchStart, bindAttrName) : null;
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
      if (filterName && !filterNameSet.has(filterName)) {
        // 4.0 で外れた名前（3.x の旧名・`substr`）も未知のフィルタ。文面だけ書き換え先を案内する
        diagnostics.push({
          code: WcsDiagnosticCode.FilterUnknown,
          start: item.exprStart + filterOffset,
          end: item.exprStart + filterOffset + filterName.length,
          message: removedFilterMessage(filterName, filterArgsOf(segment), msgs) ?? msgs.filterUnknown(filterName),
          severity: "warning",
        });
      }
    }
  }

  return diagnostics;
}

/** フィルタの区間（`substr(2, 3)`）の引数（最初の `(` と最後の `)` の間を引用符の外の `,` で切る。ランタイムと同じ）。 */
function filterArgsOf(segment: string): string[] {
  const text = segment.trim();
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open === -1 || close <= open) return [];
  const args = splitOutsideQuotes(text.slice(open + 1, close), ",").map((a) => a.trim());
  if (args[args.length - 1] === "") args.pop();
  return args;
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
  // `$recursion` 宣言済みの木の展開形（深さを畳んでから候補集合に当てる）・数値の添字のパス。
  // bindingValidator の validatePathExistence と同じ規則。
  return pathExistsInCandidates(path, scopedPaths, pathSet);
}
