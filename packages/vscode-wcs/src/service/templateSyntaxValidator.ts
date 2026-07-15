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
import { getStatePathsFromHtml } from "./statePathResolver.js";
import { findAllCommentBindings, findAllMustacheSyntax } from "./templateSyntax.js";
import { isInsideForTemplate, getInnermostForPath } from "./forContext.js";
import { WcsDiagnosticCode } from "../core/diagnostics.js";
import type { BindingDiagnostic } from "./bindingValidator.js";

export function validateTemplateSyntax(
  html: string,
  stateTagName: string,
  bindAttrName: string = "data-wcs",
): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];

  const allPaths = getStatePathsFromHtml(html, stateTagName);
  if (allPaths.length === 0) return diagnostics;

  const defaultPaths = allPaths.filter((p) => p.stateName === "default");
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
        message: `wcs-text バインディング: ${item.expression}`,
        severity: "info",
      });
    }

    if (item.kind === "mustache" && !item.insideTemplate) {
      diagnostics.push({
        code: WcsDiagnosticCode.TemplateSyntax,
        start: item.matchStart,
        end: item.matchEnd,
        message: `<template> 外の {{ }} 構文は FOUC（初期表示時にテンプレート文字列が見える）の原因になります。<!--@@:${item.expression}--> またはコメント構文の使用を検討してください。`,
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
          message: `パターンパス "${pathPart}" は <template for> の外側では使用できません`,
          severity: "warning",
        });
      }
      if (!insideFor && pathPart.startsWith(".")) {
        diagnostics.push({
          code: WcsDiagnosticCode.TemplateSyntax,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: `省略パス "${pathPart}" は <template for> の外側では使用できません`,
          severity: "warning",
        });
      }
      if (/\.\d+\.|\.\d+$/.test(pathPart)) {
        diagnostics.push({
          code: WcsDiagnosticCode.TemplateSyntax,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: `解決済みパス "${pathPart}" は UI バインディングでは使用できません。パターンパスを使用してください`,
          severity: "warning",
        });
      }

      if (pathPart.startsWith(".")) {
        const forPath = insideFor ? getInnermostForPath(html, item.matchStart, bindAttrName) : null;
        if (forPath && !forPath.startsWith(".")) {
          const expandedPath = `${forPath}.*.${pathPart.slice(1)}`;
          if (!isValidTemplatePath(expandedPath, pathSet, defaultPaths)) {
            diagnostics.push({
              code: WcsDiagnosticCode.BindingPathMissing,
              start: item.exprStart,
              end: item.exprStart + pathPart.length,
              message: `パス "${pathPart}" は状態定義に存在しません（展開: ${expandedPath}）`,
              severity: "warning",
            });
          }
        }
      } else if (!isValidTemplatePath(pathPart, pathSet, defaultPaths)) {
        diagnostics.push({
          code: WcsDiagnosticCode.BindingPathMissing,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: `パス "${pathPart}" は状態定義に存在しません`,
          severity: "warning",
        });
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
          message: `フィルタ "${filterName}" は組み込みフィルタに存在しません`,
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
