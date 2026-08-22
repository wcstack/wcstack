#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/cli.ts
var cli_exports = {};
__export(cli_exports, {
  createFileReader: () => createFileReader,
  main: () => main,
  parseArgs: () => parseArgs,
  resolveCliLocale: () => resolveCliLocale
});
module.exports = __toCommonJS(cli_exports);
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

// src/core/offsetToPosition.ts
function createPositionMapper(text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      lineStarts.push(i + 1);
    } else if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      lineStarts.push(i + 1);
    }
  }
  return (offset) => {
    const clamped = Math.max(0, Math.min(offset, text.length));
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (lineStarts[mid] <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: clamped - lineStarts[lo] + 1 };
  };
}

// src/core/diagnostics.ts
var WcsDiagnosticCode = {
  // --- sidecar manifest envelope / schema subset ---
  ManifestBroken: "wcs/manifest-broken",
  ManifestSchemaVersion: "wcs/manifest-schema-version",
  ManifestKindInvalid: "wcs/manifest-kind-invalid",
  ManifestUnknownKeyword: "wcs/manifest-unknown-keyword",
  ManifestExternalRef: "wcs/manifest-external-ref",
  ManifestRefCycle: "wcs/manifest-ref-cycle",
  ManifestRefUnresolved: "wcs/manifest-ref-unresolved",
  ManifestNamespaceVersion: "wcs/manifest-namespace-version",
  // --- sidecar resolution: collision / override ---
  // 同名 tag / filter の後勝ち禁止(§5-3)。override:true が無い再定義もこの collision で表す。
  ManifestTagCollision: "wcs/manifest-tag-collision",
  ManifestFilterCollision: "wcs/manifest-filter-collision",
  // 明示 override:true(§5-4)。衝突ではなく意図的な shadow の告知(info)。
  ManifestOverride: "wcs/manifest-override",
  // --- sidecar vs live declaration drift ---
  DriftMissingMember: "wcs/drift-missing-member",
  DriftEventMismatch: "wcs/drift-event-mismatch",
  // --- path / type resolution against a stateSchema ---
  PathNonexistent: "wcs/path-nonexistent",
  PathTypeMismatch: "wcs/path-type-mismatch",
  PathReadonly: "wcs/path-readonly",
  PathReservedName: "wcs/path-reserved-name",
  PathDynamicUnknown: "wcs/path-dynamic-unknown",
  // --- existing binding-expression validators (retrofitted) ---
  FilterUnknown: "wcs/filter-unknown",
  FilterArity: "wcs/filter-arity",
  FilterArgType: "wcs/filter-arg-type",
  FilterInputType: "wcs/filter-input-type",
  BindingPathMissing: "wcs/binding-path-missing",
  BindingTypeExpectation: "wcs/binding-type-expectation",
  TokenUndeclared: "wcs/token-undeclared",
  TokenMisconfigured: "wcs/token-misconfigured",
  NestedAssign: "wcs/nested-assign",
  // --- <wcs-state> script: $watch declaration ---
  // ランタイム（watch/processWatchDeclaration.ts）が raiseError で落とす宣言。
  // 越境 `@` / `$` 始まり / 空キー・空セグメント / 明らかな非関数ハンドラ。
  WatchDeclarationInvalid: "wcs/watch-declaration-invalid",
  // `$watch` のキーが状態定義に存在しない。バインディング側と違い黙って発火しない
  // だけなので気づけない。severity は binding-path-missing に揃える（warning）。
  WatchPathMissing: "wcs/watch-path-missing",
  TypeAnnotation: "wcs/type-annotation",
  TemplateSyntax: "wcs/template-syntax",
  // --- <wcs-state> script: array reactivity hazards ---
  // 配列破壊的メソッド呼び出し(push 等 9 種)。Proxy を素通りしリアクティブ更新されない。
  // 同一参照の自己再代入でも要素の追加・削除は反映されない(docs/array-mutation-diagnostic-design.md §3)。
  ArrayMutation: "wcs/array-mutation",
  // 配列インデックスへの直接代入(bracket-only チェーン)。同上。正はドットパス代入。
  // ドットアクセスを含むチェーン代入は NestedAssign の担当(相補・二重報告なし)。
  ArrayIndexAssign: "wcs/array-index-assign",
  // --- built-in wcs-* tag contract (generated/builtinTags.generated.ts が正本) ---
  // 未知メンバーへのバインド(プロパティ / command. / eventToken. キー)。黙って無視される。
  TagMemberUnknown: "wcs/tag-member-unknown",
  // trigger バインド先スロットの true シード(エッジ検出なし・manual バイパスで即発火)。
  TriggerSeededTruthy: "wcs/trigger-seeded-truthy",
  // 非 manual <wcs-storage> value バインド先の空値シード(初期書き戻しが保存値を上書き)。
  StorageSeedClobber: "wcs/storage-seed-clobber",
  // --- document-level load configuration ---
  // @wcstack/state/auto より後に他 wcstack /auto が読まれている。
  ScriptOrder: "wcs/script-order",
  // router/auto があるのに <base href> がない(SPA の basename 誤導出)。
  BaseHrefMissing: "wcs/base-href-missing",
  // @wcstack/signals と /dom エントリの同一ページ混在(リアクティブコア二重化)。
  SignalsDualEntry: "wcs/signals-dual-entry"
};
function sortDiagnostics(diagnostics) {
  const severityRank = { error: 0, warning: 1, info: 2 };
  return [...diagnostics].sort((a, b) => a.start - b.start || severityRank[a.severity] - severityRank[b.severity] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

// ../state/dist/manifest.esm.js
var builtinFilterMeta = {
  // 比較・論理
  eq: { description: "\u7B49\u3057\u3044\u304B\u6BD4\u8F03", hasArgs: true, resultType: "boolean", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  ne: { description: "\u7570\u306A\u308B\u304B\u6BD4\u8F03", hasArgs: true, resultType: "boolean", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  not: { description: "\u30D6\u30FC\u30EB\u5024\u3092\u53CD\u8EE2", hasArgs: false, resultType: "boolean", acceptTypes: ["boolean"], minArgs: 0, maxArgs: 0 },
  lt: { description: "\u3088\u308A\u5C0F\u3055\u3044\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  le: { description: "\u4EE5\u4E0B\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  gt: { description: "\u3088\u308A\u5927\u304D\u3044\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  ge: { description: "\u4EE5\u4E0A\u304B", hasArgs: true, resultType: "boolean", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  // 算術
  inc: { description: "\u52A0\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  dec: { description: "\u6E1B\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  mul: { description: "\u4E57\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  div: { description: "\u9664\u7B97", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  mod: { description: "\u5270\u4F59", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  abs: { description: "\u7D76\u5BFE\u5024", hasArgs: false, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 0 },
  clamp: { description: "\u7BC4\u56F2\u5185\u306B\u4E38\u3081\u308B (min,max)", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 2, maxArgs: 2, argTypes: ["number", "number"] },
  // 数値フォーマット
  fix: { description: "\u56FA\u5B9A\u5C0F\u6570\u70B9\u8868\u8A18", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  locale: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u3067\u6570\u5024\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  // 文字列
  uc: { description: "\u5927\u6587\u5B57\u306B\u5909\u63DB", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  lc: { description: "\u5C0F\u6587\u5B57\u306B\u5909\u63DB", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  cap: { description: "\u5148\u982D\u6587\u5B57\u3092\u5927\u6587\u5B57\u306B", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  trim: { description: "\u524D\u5F8C\u306E\u7A7A\u767D\u3092\u524A\u9664", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  slice: { description: "\u90E8\u5206\u6587\u5B57\u5217 (start[,end])", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "number"] },
  substr: { description: "\u90E8\u5206\u6587\u5B57\u5217 (pos,len)", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "number"] },
  pad: { description: "\u30D1\u30C7\u30A3\u30F3\u30B0 (length[,char])", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "string"] },
  rep: { description: "\u7E70\u308A\u8FD4\u3057 (count)", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 1, argTypes: ["number"] },
  rev: { description: "\u6587\u5B57\u9806\u3092\u53CD\u8EE2", hasArgs: false, resultType: "string", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 },
  truncate: { description: "\u5207\u308A\u8A70\u3081\u3066\u7701\u7565\u8A18\u53F7 (length[,suffix])", hasArgs: true, resultType: "string", acceptTypes: ["string"], minArgs: 1, maxArgs: 2, argTypes: ["number", "string"] },
  join: { description: "\u914D\u5217\u3092\u9023\u7D50 ([separator])", hasArgs: true, resultType: "string", acceptTypes: ["array"], minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  // 数値パース・丸め
  int: { description: "\u6574\u6570\u306B\u30D1\u30FC\u30B9", hasArgs: false, resultType: "number", acceptTypes: ["string", "number"], minArgs: 0, maxArgs: 0 },
  float: { description: "\u6D6E\u52D5\u5C0F\u6570\u70B9\u6570\u306B\u30D1\u30FC\u30B9", hasArgs: false, resultType: "number", acceptTypes: ["string", "number"], minArgs: 0, maxArgs: 0 },
  round: { description: "\u56DB\u6368\u4E94\u5165", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  floor: { description: "\u5207\u308A\u4E0B\u3052", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  ceil: { description: "\u5207\u308A\u4E0A\u3052", hasArgs: true, resultType: "number", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  percent: { description: "\u30D1\u30FC\u30BB\u30F3\u30C6\u30FC\u30B8\u5F62\u5F0F", hasArgs: true, resultType: "string", acceptTypes: ["number"], minArgs: 0, maxArgs: 1, argTypes: ["number"] },
  // number だけでなく string も受ける。実用チェーンは fix / percent の後ろに繋がり、
  // それらは既に string を返すため（builtinFilters.ts の unit を参照）
  unit: { description: "\u5358\u4F4D\uFF08\u63A5\u5C3E\u8F9E\uFF09\u3092\u4ED8\u52A0", hasArgs: true, resultType: "string", acceptTypes: ["number", "string"], minArgs: 1, maxArgs: 1, argTypes: ["string"] },
  // 日付・時刻
  date: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u306E\u65E5\u4ED8", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  time: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u306E\u6642\u523B", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  datetime: { description: "\u30ED\u30B1\u30FC\u30EB\u5F62\u5F0F\u306E\u65E5\u6642", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  ymd: { description: "YYYY-MM-DD \u5F62\u5F0F", hasArgs: true, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  hms: { description: "HH:MM:SS \u5F62\u5F0F", hasArgs: true, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 1, argTypes: ["string"] },
  // 真偽値・変換
  falsy: { description: "\u507D\u5024\u304B\u5224\u5B9A", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  truthy: { description: "\u771F\u5024\u304B\u5224\u5B9A", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  defaults: { description: "\u507D\u5024\u306E\u5834\u5408\u30C7\u30D5\u30A9\u30EB\u30C8\u5024", hasArgs: true, resultType: "passthrough", acceptTypes: "any", minArgs: 1, maxArgs: 1, argTypes: ["any"] },
  boolean: { description: "\u30D6\u30FC\u30EB\u5024\u306B\u5909\u63DB", hasArgs: false, resultType: "boolean", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  number: { description: "\u6570\u5024\u306B\u5909\u63DB", hasArgs: false, resultType: "number", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  string: { description: "\u6587\u5B57\u5217\u306B\u5909\u63DB", hasArgs: false, resultType: "string", acceptTypes: "any", minArgs: 0, maxArgs: 0 },
  null: { description: "\u7A7A\u6587\u5B57\u5217\u3092null\u306B\u5909\u63DB", hasArgs: false, resultType: "passthrough", acceptTypes: ["string"], minArgs: 0, maxArgs: 0 }
};
var STRUCTURAL_BINDING_TYPE_SET = /* @__PURE__ */ new Set([
  "if",
  "elseif",
  "else",
  "for"
]);
var MAX_WILDCARD_DEPTH = 128;
var MODIFIER_PREVENT = "prevent";
var MODIFIER_STOP = "stop";
var MODIFIER_READONLY = "ro";
var MODIFIER_FLAGS = Object.freeze([
  MODIFIER_PREVENT,
  MODIFIER_STOP,
  MODIFIER_READONLY
]);
var MODIFIER_KEY_INIT = "init";
var MODIFIER_KEY_SYNC = "sync";
var MODIFIER_KEYS = Object.freeze([
  MODIFIER_KEY_INIT,
  MODIFIER_KEY_SYNC
]);
var INDEX_PARAM_PREFIX = "$";
var tmpIndexByIndexName = {};
for (let i = 0; i < MAX_WILDCARD_DEPTH; i++) {
  tmpIndexByIndexName[`${INDEX_PARAM_PREFIX}${i + 1}`] = i;
}
Object.freeze(tmpIndexByIndexName);

// src/service/completionData.ts
var BUILTIN_FILTERS = Object.entries(builtinFilterMeta).map(
  ([name, meta]) => ({ name, ...meta })
);
var STRUCTURAL_DIRECTIVE_INFO = {
  for: { description: "\u30EA\u30B9\u30C8\u30EC\u30F3\u30C0\u30EA\u30F3\u30B0 (<template>)", insertColon: true },
  if: { description: "\u6761\u4EF6\u4ED8\u304D\u30EC\u30F3\u30C0\u30EA\u30F3\u30B0 (<template>)", insertColon: true },
  elseif: { description: "else-if \u6761\u4EF6 (<template>)", insertColon: true },
  else: { description: "else \u30D6\u30ED\u30C3\u30AF (<template>)", insertColon: false }
};
var STRUCTURAL_DIRECTIVES = [...STRUCTURAL_BINDING_TYPE_SET].map((name) => ({
  name,
  ...STRUCTURAL_DIRECTIVE_INFO[name]
}));

// src/language/htmlParse.ts
function parseWcsScriptBlocks(html, stateTagName = "wcs-state") {
  const blocks = [];
  let pos = 0;
  const len = html.length;
  while (pos < len) {
    if (html.startsWith("<!--", pos)) {
      const commentEnd = html.indexOf("-->", pos + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }
    const wcsMatch = matchOpenTag(html, pos, stateTagName);
    if (wcsMatch === null) {
      pos++;
      continue;
    }
    const stateName = extractAttribute(wcsMatch.tagContent, "name") ?? "default";
    pos = wcsMatch.end;
    const wcsCloseIdx = findCloseTag(html, pos, stateTagName);
    const wcsEnd = wcsCloseIdx === -1 ? len : wcsCloseIdx;
    while (pos < wcsEnd) {
      if (html.startsWith("<!--", pos)) {
        const commentEnd = html.indexOf("-->", pos + 4);
        if (commentEnd === -1) break;
        pos = commentEnd + 3;
        continue;
      }
      const scriptMatch = matchOpenTag(html, pos, "script");
      if (scriptMatch === null) {
        pos++;
        continue;
      }
      const typeAttr = extractAttribute(scriptMatch.tagContent, "type");
      if (typeAttr?.toLowerCase() !== "module") {
        pos = scriptMatch.end;
        continue;
      }
      const contentStart = scriptMatch.end;
      const scriptCloseIdx = findCloseTag(html, contentStart, "script");
      if (scriptCloseIdx === -1) {
        pos = contentStart;
        break;
      }
      const contentEnd = scriptCloseIdx;
      blocks.push({
        contentStart,
        contentEnd,
        content: html.slice(contentStart, contentEnd),
        stateName
      });
      pos = html.indexOf(">", scriptCloseIdx) + 1;
      if (pos === 0) break;
    }
    pos = wcsEnd;
    if (wcsCloseIdx !== -1) {
      const closeEnd = html.indexOf(">", wcsCloseIdx);
      if (closeEnd !== -1) pos = closeEnd + 1;
    }
  }
  return blocks;
}
function parseWcsStateElements(html, stateTagName = "wcs-state") {
  const elements = [];
  let pos = 0;
  const len = html.length;
  while (pos < len) {
    if (html.startsWith("<!--", pos)) {
      const commentEnd = html.indexOf("-->", pos + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }
    const wcsMatch = matchOpenTag(html, pos, stateTagName);
    if (wcsMatch === null) {
      pos++;
      continue;
    }
    const stateName = extractAttribute(wcsMatch.tagContent, "name") ?? "default";
    const jsonAttr = extractAttribute(wcsMatch.tagContent, "json") ?? void 0;
    const stateAttr = extractAttribute(wcsMatch.tagContent, "state") ?? void 0;
    const srcAttr = extractAttribute(wcsMatch.tagContent, "src") ?? void 0;
    const tagStart = pos;
    const tagEnd = wcsMatch.end;
    pos = wcsMatch.end;
    const scriptBlocks = [];
    const wcsCloseIdx = findCloseTag(html, pos, stateTagName);
    const wcsEnd = wcsCloseIdx === -1 ? len : wcsCloseIdx;
    while (pos < wcsEnd) {
      if (html.startsWith("<!--", pos)) {
        const commentEnd = html.indexOf("-->", pos + 4);
        if (commentEnd === -1) break;
        pos = commentEnd + 3;
        continue;
      }
      const scriptMatch = matchOpenTag(html, pos, "script");
      if (scriptMatch === null) {
        pos++;
        continue;
      }
      const typeAttr = extractAttribute(scriptMatch.tagContent, "type");
      if (typeAttr?.toLowerCase() !== "module") {
        pos = scriptMatch.end;
        continue;
      }
      const contentStart = scriptMatch.end;
      const scriptCloseIdx = findCloseTag(html, contentStart, "script");
      if (scriptCloseIdx === -1) {
        pos = contentStart;
        break;
      }
      scriptBlocks.push({
        contentStart,
        contentEnd: scriptCloseIdx,
        content: html.slice(contentStart, scriptCloseIdx),
        stateName
      });
      pos = html.indexOf(">", scriptCloseIdx) + 1;
      if (pos === 0) break;
    }
    elements.push({ stateName, jsonAttr, stateAttr, srcAttr, scriptBlocks, tagStart, tagEnd });
    pos = wcsEnd;
    if (wcsCloseIdx !== -1) {
      const closeEnd = html.indexOf(">", wcsCloseIdx);
      if (closeEnd !== -1) pos = closeEnd + 1;
    }
  }
  return elements;
}
function findScriptJsonById(html, id) {
  let pos = 0;
  const len = html.length;
  while (pos < len) {
    if (html.startsWith("<!--", pos)) {
      const commentEnd = html.indexOf("-->", pos + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }
    const scriptMatch = matchOpenTag(html, pos, "script");
    if (scriptMatch === null) {
      pos++;
      continue;
    }
    const typeAttr = extractAttribute(scriptMatch.tagContent, "type");
    const idAttr = extractAttribute(scriptMatch.tagContent, "id");
    if (typeAttr?.toLowerCase() === "application/json" && idAttr === id) {
      const contentStart = scriptMatch.end;
      const scriptCloseIdx = findCloseTag(html, contentStart, "script");
      if (scriptCloseIdx === -1) return null;
      return html.slice(contentStart, scriptCloseIdx);
    }
    pos = scriptMatch.end;
  }
  return null;
}
function matchOpenTag(html, pos, tagName) {
  if (html[pos] !== "<") return null;
  const nameStart = pos + 1;
  const nameEnd = nameStart + tagName.length;
  if (nameEnd > html.length) return null;
  const slice = html.slice(nameStart, nameEnd);
  if (slice.toLowerCase() !== tagName.toLowerCase()) return null;
  const charAfter = html[nameEnd];
  if (charAfter !== ">" && charAfter !== " " && charAfter !== "	" && charAfter !== "\n" && charAfter !== "\r" && charAfter !== "/") {
    return null;
  }
  let i = nameEnd;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  while (i < html.length) {
    const ch = html[i];
    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
    } else if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
    } else if (ch === "'") {
      inSingleQuote = true;
    } else if (ch === '"') {
      inDoubleQuote = true;
    } else if (ch === ">") {
      return {
        start: pos,
        end: i + 1,
        tagContent: html.slice(nameEnd, i)
      };
    }
    i++;
  }
  return null;
}
function findCloseTag(html, startPos, tagName) {
  const pattern = "</" + tagName;
  const patternLower = pattern.toLowerCase();
  const htmlLower = html.toLowerCase();
  let pos = startPos;
  while (pos < html.length) {
    const idx = htmlLower.indexOf(patternLower, pos);
    if (idx === -1) return -1;
    const afterIdx = idx + pattern.length;
    if (afterIdx < html.length) {
      const ch = html[afterIdx];
      if (ch === ">" || ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        return idx;
      }
    }
    pos = idx + 1;
  }
  return -1;
}
function extractAttribute(tagContent, attrName) {
  const regex = new RegExp(
    `(?:^|\\s)${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`,
    "i"
  );
  const match = tagContent.match(regex);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

// src/service/stateAnalyzer.ts
var RESERVED_STREAMS_KEY = "$streams";
var RESERVED_COMMAND_TOKENS_KEY = "$commandTokens";
var RESERVED_EVENT_TOKENS_KEY = "$eventTokens";
var RESERVED_LIST_KEYS_KEY = "$listKeys";
var RESERVED_WATCH_KEY = "$watch";
function analyzeStatePaths(scriptContent, stateName = "default") {
  const objectContent = extractDefaultExportObject(scriptContent);
  if (!objectContent) return [];
  const paths = [];
  const topLevelProps = parseTopLevelProperties(objectContent);
  const pendingStreamValues = [];
  const pendingListKeys = [];
  for (const prop of topLevelProps) {
    if (prop.name.startsWith("$")) {
      collectReservedKeyPaths(prop, paths, pendingStreamValues, pendingListKeys, stateName);
      continue;
    }
    if (prop.kind === "method") {
      paths.push({ path: prop.name, kind: "method", stateName });
      continue;
    }
    if (prop.kind === "getter") {
      if (!paths.some((p) => p.stateName === stateName && p.path === prop.name)) {
        paths.push({ path: prop.name, kind: "computed", stateName });
      }
      continue;
    }
    pushDataPropertyPaths(prop, paths, stateName);
  }
  for (const streamValue of pendingStreamValues) {
    if (paths.some((p) => p.stateName === stateName && p.path === streamValue.name)) continue;
    pushDataPropertyPaths(streamValue, paths, stateName);
  }
  for (const listKeyEntry of pendingListKeys) {
    pushListKeyPaths(listKeyEntry, paths, stateName);
  }
  return paths;
}
function analyzeWatchEntries(scriptContent) {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return [];
  const watchProp = parseTopLevelProperties(root.content).find((p) => p.name === RESERVED_WATCH_KEY);
  if (!watchProp || watchProp.kind !== "data" || !watchProp.value || !isObjectLiteral(watchProp.value) || watchProp.valueStart === void 0) {
    return [];
  }
  const leading = watchProp.value.length - watchProp.value.trimStart().length;
  const innerStart = root.start + watchProp.valueStart + leading + 1;
  const entries = [];
  for (const entry of parseTopLevelProperties(extractObjectContent(watchProp.value))) {
    if (entry.nameStart === void 0 || entry.nameEnd === void 0) continue;
    entries.push({
      key: entry.name,
      start: innerStart + entry.nameStart,
      end: innerStart + entry.nameEnd,
      // メソッド短縮記法は関数。data は値リテラルの形で判定し、識別子参照は疑わない。
      definitelyNotFunction: entry.kind === "data" && isNonFunctionLiteral(entry.value)
    });
  }
  return entries;
}
function isNonFunctionLiteral(value) {
  if (value === void 0) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const scan = maskCommentsAndStrings(trimmed);
  if (/^(?:async\s+)?function\b/.test(trimmed) || scan.includes("=>")) return false;
  return /^["'`]/.test(trimmed) || /^-?\d/.test(trimmed) || /^(?:true|false|null|undefined)\b/.test(trimmed) || trimmed.startsWith("[") || trimmed.startsWith("{");
}
function findNonObjectWatch(scriptContent) {
  const root = locateDefaultExportObject(scriptContent);
  if (!root) return null;
  const watchProp = parseTopLevelProperties(root.content).find((p) => p.name === RESERVED_WATCH_KEY);
  if (!watchProp || watchProp.nameStart === void 0 || watchProp.nameEnd === void 0) {
    return null;
  }
  const span = { start: root.start + watchProp.nameStart, end: root.start + watchProp.nameEnd };
  if (watchProp.kind === "method") {
    return span;
  }
  if (watchProp.kind !== "data" || !watchProp.value) return null;
  const trimmed = watchProp.value.trim();
  if (trimmed.startsWith("{")) return null;
  const scan = maskCommentsAndStrings(trimmed).trim();
  const isArrowFunction = /^(?:async\s+)?\([^()]*\)\s*=>/.test(scan) || /^(?:async\s+)?[$\w]+\s*=>/.test(scan);
  const isWholeLiteral = /^(["'`])[^"'`]*\1$/.test(scan) || /^-?\d[\w.]*$/.test(scan) || /^(?:true|false|null)$/.test(scan) || /^(?:async\s+)?function\b[\s\S]*\}$/.test(scan);
  if (!isArrowFunction && !isWholeLiteral) return null;
  return span;
}
function collectReservedKeyPaths(prop, paths, pendingStreamValues, pendingListKeys, stateName) {
  if (prop.name === RESERVED_STREAMS_KEY && prop.kind === "data" && prop.value && isObjectLiteral(prop.value)) {
    const entries = parseTopLevelProperties(extractObjectContent(prop.value));
    for (const entry of entries) {
      if (entry.kind !== "data" || entry.name.startsWith("$")) continue;
      const initial = entry.value && isObjectLiteral(entry.value) ? findStreamInitialProperty(entry.value) : void 0;
      pendingStreamValues.push({
        name: entry.name,
        kind: "data",
        value: initial?.value,
        typeHint: initial?.typeHint
      });
      paths.push({ path: `$streamStatus.${entry.name}`, kind: "data", typeHint: "string", stateName });
      paths.push({ path: `$streamError.${entry.name}`, kind: "data", stateName });
    }
    return;
  }
  if (prop.name === RESERVED_COMMAND_TOKENS_KEY && prop.value) {
    for (const name of extractStringArrayItems(prop.value)) {
      paths.push({ path: `$command.${name}`, kind: "command", stateName });
    }
    return;
  }
  if (prop.name === RESERVED_EVENT_TOKENS_KEY && prop.value) {
    for (const name of extractStringArrayItems(prop.value)) {
      paths.push({ path: name, kind: "eventToken", stateName });
    }
    return;
  }
  if (prop.name === RESERVED_LIST_KEYS_KEY && prop.kind === "data" && prop.value && isObjectLiteral(prop.value)) {
    for (const entry of parseTopLevelProperties(extractObjectContent(prop.value))) {
      if (entry.kind !== "data") continue;
      pendingListKeys.push(entry);
    }
    return;
  }
}
function pushListKeyPaths(entry, paths, stateName) {
  const listPath = entry.name;
  const segments = listPath.split(".");
  if (listPath.length === 0 || segments.some((s) => s.length === 0) || segments[segments.length - 1] === "*") {
    return;
  }
  const has = (path) => paths.some((p) => p.stateName === stateName && p.path === path);
  if (!has(listPath)) paths.push({ path: listPath, kind: "data", typeHint: "array", stateName });
  if (!has(`${listPath}.*`)) paths.push({ path: `${listPath}.*`, kind: "list", stateName });
  if (!has(`${listPath}.length`)) {
    paths.push({ path: `${listPath}.length`, kind: "data", typeHint: "number", stateName });
  }
  const keyField = extractStringLiteralValue(entry.value);
  if (keyField === null || keyField.includes(".") || keyField.includes("*")) return;
  if (!has(`${listPath}.*.${keyField}`)) {
    paths.push({ path: `${listPath}.*.${keyField}`, kind: "data", stateName });
  }
}
function extractStringLiteralValue(value) {
  if (!value) return null;
  const match = value.trim().match(/^["']([^"'\\]*)["']$/);
  return match && match[1].length > 0 ? match[1] : null;
}
function findStreamInitialProperty(entryValue) {
  const defProps = parseTopLevelProperties(extractObjectContent(entryValue));
  return defProps.find((p) => p.kind === "data" && p.name === "initial");
}
function extractStringArrayItems(value) {
  if (!isArrayLiteral(value)) return [];
  const items = [];
  const regex = /["']([^"'\\]+)["']/g;
  let match;
  while ((match = regex.exec(value)) !== null) {
    items.push(match[1]);
  }
  return items;
}
var MAX_OBJECT_NEST_DEPTH = 5;
function pushDataPropertyPaths(prop, paths, stateName) {
  pushDataPropertyPathsAt(prop.name, prop, paths, stateName, 0);
}
function pushDataPropertyPathsAt(path, prop, paths, stateName, depth) {
  paths.push({ path, kind: "data", typeHint: prop.typeHint, rawInitial: prop.value?.trim(), stateName });
  if (prop.value && isArrayLiteral(prop.value)) {
    paths.push({ path: `${path}.*`, kind: "list", stateName });
    paths.push({ path: `${path}.length`, kind: "data", typeHint: "number", stateName });
    const elementProps = extractArrayElementProperties(prop.value);
    for (const childProp of elementProps) {
      paths.push({
        path: `${path}.*.${childProp.name}`,
        kind: "data",
        typeHint: childProp.typeHint,
        stateName
      });
    }
    return;
  }
  if (prop.value && isObjectLiteral(prop.value)) {
    if (depth >= MAX_OBJECT_NEST_DEPTH) return;
    const childProps = parseTopLevelProperties(extractObjectContent(prop.value));
    for (const childProp of childProps) {
      if (childProp.kind !== "data") continue;
      pushDataPropertyPathsAt(`${path}.${childProp.name}`, childProp, paths, stateName, depth + 1);
    }
  }
}
function analyzeJsonPaths(jsonString, stateName = "default") {
  let data;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return [];
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
  const paths = [];
  collectJsonPaths(data, "", paths, stateName, 0);
  return paths;
}
function collectJsonPaths(obj, prefix, paths, stateName, depth) {
  if (depth > 5) return;
  for (const [key, value] of Object.entries(obj)) {
    if (prefix === "" && key.startsWith("$")) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const typeHint = inferJsonTypeHint(value);
    paths.push({ path, kind: "data", typeHint, stateName });
    if (Array.isArray(value)) {
      paths.push({ path: `${path}.*`, kind: "list", stateName });
      paths.push({ path: `${path}.length`, kind: "data", typeHint: "number", stateName });
      if (value.length > 0 && typeof value[0] === "object" && value[0] !== null && !Array.isArray(value[0])) {
        const firstElement = value[0];
        for (const [childKey, childValue] of Object.entries(firstElement)) {
          const childPath = `${path}.*.${childKey}`;
          paths.push({ path: childPath, kind: "data", typeHint: inferJsonTypeHint(childValue), stateName });
        }
      }
    } else if (typeof value === "object" && value !== null) {
      collectJsonPaths(value, path, paths, stateName, depth + 1);
    }
  }
}
function inferJsonTypeHint(value) {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return void 0;
}
function locateDefaultExportObject(script) {
  const scan = maskCommentsAndStrings(script);
  const match = scan.match(/export\s+default\s+(?:defineState\s*\(\s*)?(\{)/);
  if (!match) return null;
  const braceIndex = scan.indexOf(match[1], match.index);
  return { content: extractBracedContent(script, scan, braceIndex), start: braceIndex + 1 };
}
function extractDefaultExportObject(script) {
  return locateDefaultExportObject(script)?.content ?? null;
}
function parseTopLevelProperties(objectContent) {
  const props = [];
  const scan = maskCommentsAndStrings(objectContent);
  const regex = /(?:(?:get|set)\s+(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*\([^)]*\)\s*\{)|(?:(?:async\s+)?(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*\([^)]*\)\s*\{)|(?:(?:"([^"]+)"|'([^']+)'|([$\w]+))\s*:\s*)/gd;
  let match;
  while ((match = regex.exec(scan)) !== null) {
    const indices = match.indices;
    let nameSpan;
    const nameAt = (group) => {
      const span = indices[group];
      if (!span) return void 0;
      nameSpan = [span[0], span[1]];
      return objectContent.slice(span[0], span[1]);
    };
    const skipBody = () => {
      const braceStart = match.index + match[0].length - 1;
      const body = extractBracedContent(objectContent, scan, braceStart);
      regex.lastIndex = braceStart + body.length + 2;
    };
    const accessorName = nameAt(1) ?? nameAt(2) ?? nameAt(3);
    if (accessorName) {
      props.push({ name: accessorName, kind: "getter", nameStart: nameSpan[0], nameEnd: nameSpan[1] });
      skipBody();
      continue;
    }
    const methodName = nameAt(4) ?? nameAt(5) ?? nameAt(6);
    if (methodName) {
      props.push({ name: methodName, kind: "method", nameStart: nameSpan[0], nameEnd: nameSpan[1] });
      skipBody();
      continue;
    }
    const propName = nameAt(7) ?? nameAt(8) ?? nameAt(9);
    if (propName) {
      const valueStartIndex = match.index + match[0].length;
      const value = extractFullValue(objectContent, scan, valueStartIndex);
      const jsdocType = extractJsDocType(objectContent, match.index);
      const typeHint = jsdocType ?? inferTypeHint(value);
      props.push({
        name: propName,
        kind: "data",
        value,
        typeHint,
        nameStart: nameSpan[0],
        nameEnd: nameSpan[1],
        valueStart: valueStartIndex
      });
      regex.lastIndex = valueStartIndex + value.length;
    }
  }
  return props;
}
function maskCommentsAndStrings(source) {
  const out = source.split("");
  const len = source.length;
  const blank = (i2) => {
    if (source[i2] !== "\n" && source[i2] !== "\r") out[i2] = " ";
  };
  let i = 0;
  while (i < len) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < len && source[i] !== "\n") blank(i++);
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) blank(i++);
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i++;
      while (i < len && source[i] !== ch) {
        if (source[i] === "\\") blank(i++);
        if (i < len) blank(i++);
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
}
function extractFullValue(content, scan, startIndex) {
  let depth = 0;
  let i = startIndex;
  const len = scan.length;
  let inString = null;
  while (i < len) {
    const ch = scan[i];
    if (inString) {
      if (ch === inString && !isEscaped(scan, i)) {
        inString = null;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) {
      break;
    }
    i++;
  }
  return content.slice(startIndex, i).trim();
}
function extractBracedContent(text, scan, openBraceIndex) {
  let depth = 0;
  let inString = null;
  for (let i = openBraceIndex; i < scan.length; i++) {
    const ch = scan[i];
    if (inString) {
      if (ch === inString && !isEscaped(scan, i)) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(openBraceIndex + 1, i);
      }
    }
  }
  return text.slice(openBraceIndex + 1);
}
function isArrayLiteral(value) {
  return value.trimStart().startsWith("[");
}
function isObjectLiteral(value) {
  return value.trimStart().startsWith("{");
}
function extractObjectContent(value) {
  const trimmed = value.trim();
  const scan = maskCommentsAndStrings(trimmed);
  const start = scan.indexOf("{");
  if (start === -1) return "";
  return extractBracedContent(trimmed, scan, start);
}
function extractArrayElementProperties(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return [];
  const scan = maskCommentsAndStrings(trimmed);
  const objectStart = scan.indexOf("{");
  if (objectStart === -1) return [];
  const objectContent = extractBracedContent(trimmed, scan, objectStart);
  const props = [];
  const allProps = parseTopLevelProperties(objectContent);
  for (const prop of allProps) {
    if (prop.kind === "data") {
      props.push({ name: prop.name, typeHint: prop.typeHint });
    }
  }
  return props;
}
function extractJsDocType(content, propIndex) {
  const before = content.slice(Math.max(0, propIndex - 200), propIndex);
  const jsdocMatch = before.match(/\/\*\*\s*@type\s*\{([^}]+)\}\s*\*\/\s*$/);
  if (!jsdocMatch) return void 0;
  const typeExpr = jsdocMatch[1].trim();
  return normalizeJsDocType(typeExpr);
}
function normalizeJsDocType(typeExpr) {
  const parts = typeExpr.split("|").map((p) => p.trim());
  const normalized = parts.map((p) => {
    const lower = p.toLowerCase();
    if (lower === "string") return "string";
    if (lower === "number") return "number";
    if (lower === "boolean") return "boolean";
    if (lower === "null") return "null";
    if (lower === "undefined") return "null";
    if (lower.endsWith("[]") || lower.startsWith("array")) return "array";
    if (lower === "object") return "object";
    return null;
  }).filter((p) => p !== null);
  if (normalized.length === 0) return void 0;
  const unique = [...new Set(normalized)].sort();
  return unique.join("|");
}
function isEscaped(text, i) {
  let backslashCount = 0;
  let j = i - 1;
  while (j >= 0 && text[j] === "\\") {
    backslashCount++;
    j--;
  }
  return backslashCount % 2 === 1;
}
function inferTypeHint(valueStart) {
  const v = valueStart.trim().replace(/,\s*$/, "");
  if (/^-?\d+\.\d/.test(v)) return "number";
  if (/^-?\d/.test(v)) return "number";
  if (/^["'`]/.test(v)) return "string";
  if (v === "true" || v === "false") return "boolean";
  if (v === "null") return "null";
  if (v.startsWith("[")) return "array";
  if (v.startsWith("{")) return "object";
  return void 0;
}

// src/service/statePathResolver.ts
function getStatePathsFromHtml(html, stateTagName = "wcs-state", fileReader) {
  const elements = parseWcsStateElements(html, stateTagName);
  const allPaths = [];
  for (const element of elements) {
    const paths = resolveElementPaths(element, html, fileReader);
    allPaths.push(...paths);
  }
  return allPaths;
}
function resolveElementPaths(element, html, fileReader) {
  if (element.stateAttr) {
    const jsonContent = findScriptJsonById(html, element.stateAttr);
    if (jsonContent) {
      const paths = analyzeJsonPaths(jsonContent, element.stateName);
      if (paths.length > 0) return paths;
    }
  }
  if (element.srcAttr && fileReader) {
    const paths = resolveSrcAttribute(element.srcAttr, element.stateName, fileReader);
    if (paths.length > 0) return paths;
  }
  if (element.jsonAttr) {
    const paths = analyzeJsonPaths(element.jsonAttr, element.stateName);
    if (paths.length > 0) return paths;
  }
  if (element.scriptBlocks.length > 0) {
    return element.scriptBlocks.flatMap(
      (block) => analyzeStatePaths(block.content, block.stateName)
    );
  }
  return [];
}
function resolveSrcAttribute(srcPath, stateName, fileReader) {
  if (srcPath.endsWith(".json")) {
    const content = fileReader(srcPath);
    if (content) {
      return analyzeJsonPaths(content, stateName);
    }
    return [];
  }
  if (srcPath.endsWith(".js")) {
    const tsPath = srcPath.replace(/\.js$/, ".ts");
    const tsContent = fileReader(tsPath);
    if (tsContent) {
      return analyzeStatePaths(tsContent, stateName);
    }
    const jsContent = fileReader(srcPath);
    if (jsContent) {
      return analyzeStatePaths(jsContent, stateName);
    }
    return [];
  }
  if (srcPath.endsWith(".ts")) {
    const content = fileReader(srcPath);
    if (content) {
      return analyzeStatePaths(content, stateName);
    }
    return [];
  }
  return [];
}

// src/service/forContext.ts
function isInsideForTemplate(html, offset, bindAttrName = "data-wcs") {
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:`,
    "gi"
  );
  const closeRegex = /<\/template\s*>/gi;
  const opens = [];
  let match;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset) break;
    opens.push(match.index);
  }
  if (opens.length === 0) return false;
  for (const openPos of opens) {
    const depth = getForTemplateDepthAt(html, openPos, offset, bindAttrName);
    if (depth > 0) return true;
  }
  return false;
}
function getInnermostForPath(html, offset, bindAttrName = "data-wcs") {
  const chain = getEnclosingForPaths(html, offset, bindAttrName);
  return chain.length === 0 ? null : chain[chain.length - 1];
}
function getEnclosingForPaths(html, offset, bindAttrName = "data-wcs") {
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:\\s*([^"']+?)\\s*["']`,
    "gi"
  );
  const enclosing = [];
  let match;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset) break;
    const tagEnd = html.indexOf(">", match.index);
    if (tagEnd === -1 || tagEnd >= offset) continue;
    const depth = getForTemplateDepthAt(html, match.index, offset, bindAttrName);
    if (depth > 0) {
      enclosing.push(match[1].trim());
    }
  }
  return enclosing;
}
function getForTemplateDepthAt(html, openPos, offset, bindAttrName) {
  const tagEnd = html.indexOf(">", openPos);
  if (tagEnd === -1 || tagEnd >= offset) return 0;
  let depth = 1;
  let pos = tagEnd + 1;
  const templateOpenRegex = /<template[\s>]/gi;
  const templateCloseRegex = /<\/template\s*>/gi;
  while (pos < offset && depth > 0) {
    templateOpenRegex.lastIndex = pos;
    templateCloseRegex.lastIndex = pos;
    const nextOpen = templateOpenRegex.exec(html);
    const nextClose = templateCloseRegex.exec(html);
    const openIdx = nextOpen && nextOpen.index < offset ? nextOpen.index : Infinity;
    const closeIdx = nextClose && nextClose.index < offset ? nextClose.index : Infinity;
    if (openIdx === Infinity && closeIdx === Infinity) break;
    if (openIdx < closeIdx) {
      depth++;
      pos = openIdx + 1;
    } else {
      depth--;
      if (depth === 0 && closeIdx < offset) {
        return 0;
      }
      pos = closeIdx + (nextClose ? nextClose[0].length : 1);
    }
  }
  return depth;
}

// src/core/messages.ts
function resolveLocale(locale) {
  if (locale === void 0 || locale === "" || /^ja\b|^ja[-_]/i.test(locale) || locale.toLowerCase() === "ja") return "ja";
  return "en";
}
var JA_EXPECTED_LABEL = {
  array: "\u914D\u5217\u578B\u306E\u30D1\u30B9",
  boolean: "\u30D6\u30FC\u30EA\u30A2\u30F3\u578B",
  string: "\u6587\u5B57\u5217\u578B"
};
var ja = {
  spreadFilterNotAllowed: () => `\u30B9\u30D7\u30EC\u30C3\u30C9\u306E\u30BF\u30FC\u30B2\u30C3\u30C8\u306B\u30D5\u30A3\u30EB\u30BF\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093`,
  spreadTargetRequired: () => `\u30B9\u30D7\u30EC\u30C3\u30C9\u306B\u306F\u30BF\u30FC\u30B2\u30C3\u30C8\u30D1\u30B9\u304C\u5FC5\u8981\u3067\u3059`,
  structuralMustBeSingle: (d) => `'${d}' \u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0\u306F\u5358\u72EC\u3067\u6307\u5B9A\u3059\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\uFF08';' \u3067\u4ED6\u306E\u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0\u3068\u4F75\u8A18\u3067\u304D\u307E\u305B\u3093\u3002\u30E9\u30F3\u30BF\u30A4\u30E0\u306F\u8AAD\u307F\u8FBC\u307F\u6642\u306B throw \u3057\u307E\u3059\uFF09`,
  eventTokenUndeclared: (t) => `\u30A4\u30D9\u30F3\u30C8\u30C8\u30FC\u30AF\u30F3 "${t}" \u306F $eventTokens \u306B\u5BA3\u8A00\u3055\u308C\u3066\u3044\u307E\u305B\u3093`,
  commandRhsFormat: () => `command \u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0\u306E\u53F3\u8FBA\u306B\u306F $command.<name>\uFF08$commandTokens \u3067\u5BA3\u8A00\uFF09\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044`,
  commandTokenUndeclared: (t) => `\u30B3\u30DE\u30F3\u30C9\u30C8\u30FC\u30AF\u30F3 "${t}" \u306F $commandTokens \u306B\u5BA3\u8A00\u3055\u308C\u3066\u3044\u307E\u305B\u3093`,
  streamPathMissing: (p) => `\u30D1\u30B9 "${p}" \u306F $streams \u5BA3\u8A00\u306B\u5B58\u5728\u3057\u307E\u305B\u3093`,
  pathMissing: (p) => `\u30D1\u30B9 "${p}" \u306F\u72B6\u614B\u5B9A\u7FA9\u306B\u5B58\u5728\u3057\u307E\u305B\u3093`,
  expansionSuffix: (x) => `\uFF08\u5C55\u958B: ${x}\uFF09`,
  patternPathOutsideFor: (p) => `\u30D1\u30BF\u30FC\u30F3\u30D1\u30B9 "${p}" \u306F <template for> \u306E\u5916\u5074\u3067\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093`,
  omittedPathOutsideFor: (p) => `\u7701\u7565\u30D1\u30B9 "${p}" \u306F <template for> \u306E\u5916\u5074\u3067\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093`,
  loopIndexOutsideFor: (p) => `\u30EB\u30FC\u30D7\u30A4\u30F3\u30C7\u30C3\u30AF\u30B9 "${p}" \u306F <template for> \u306E\u5916\u5074\u3067\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093`,
  resolvedPathInUi: (p) => `\u89E3\u6C7A\u6E08\u307F\u30D1\u30B9 "${p}" \u306F UI \u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0\u3067\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093\u3002\u30D1\u30BF\u30FC\u30F3\u30D1\u30B9\u3092\u4F7F\u7528\u3057\u3066\u304F\u3060\u3055\u3044`,
  handlerFilterNotAllowed: (prop) => `\u30A4\u30D9\u30F3\u30C8\u30CF\u30F3\u30C9\u30E9 "${prop}" \u306B\u30D5\u30A3\u30EB\u30BF\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093`,
  typeExpectation: (label, expected, resultType) => `"${label}" \u306B\u306F${JA_EXPECTED_LABEL[expected]}\u304C\u5FC5\u8981\u3067\u3059\uFF08\u73FE\u5728\u306E\u578B: ${resultType}\uFF09`,
  filterUnknown: (n) => `\u30D5\u30A3\u30EB\u30BF "${n}" \u306F\u7D44\u307F\u8FBC\u307F\u30D5\u30A3\u30EB\u30BF\u306B\u5B58\u5728\u3057\u307E\u305B\u3093`,
  filterMinArgs: (n, min, c) => `\u30D5\u30A3\u30EB\u30BF "${n}" \u306B\u306F\u6700\u4F4E ${min} \u500B\u306E\u5F15\u6570\u304C\u5FC5\u8981\u3067\u3059\uFF08${c} \u500B\u6307\u5B9A\uFF09`,
  filterMaxArgs: (n, max, c) => `\u30D5\u30A3\u30EB\u30BF "${n}" \u306E\u5F15\u6570\u306F\u6700\u5927 ${max} \u500B\u3067\u3059\uFF08${c} \u500B\u6307\u5B9A\uFF09`,
  filterArgType: (n, i, exp, arg, act) => `\u30D5\u30A3\u30EB\u30BF "${n}" \u306E\u7B2C${i}\u5F15\u6570\u306F ${exp} \u578B\u304C\u5FC5\u8981\u3067\u3059\uFF08"${arg}" \u306F ${act} \u578B\uFF09`,
  filterInputType: (n, accepts, cur) => `\u30D5\u30A3\u30EB\u30BF "${n}" \u306F ${accepts} \u578B\u306E\u5165\u529B\u304C\u5FC5\u8981\u3067\u3059\uFF08\u73FE\u5728\u306E\u578B: ${cur}\uFF09`,
  wcsTextInfo: (e) => `wcs-text \u30D0\u30A4\u30F3\u30C7\u30A3\u30F3\u30B0: ${e}`,
  moustacheFouc: (e) => `<template> \u5916\u306E {{ }} \u69CB\u6587\u306F FOUC\uFF08\u521D\u671F\u8868\u793A\u6642\u306B\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u6587\u5B57\u5217\u304C\u898B\u3048\u308B\uFF09\u306E\u539F\u56E0\u306B\u306A\u308A\u307E\u3059\u3002<!--@@:${e}--> \u307E\u305F\u306F\u30B3\u30E1\u30F3\u30C8\u69CB\u6587\u306E\u4F7F\u7528\u3092\u691C\u8A0E\u3057\u3066\u304F\u3060\u3055\u3044\u3002`,
  nestedAssign: (sp) => `\u30CD\u30B9\u30C8\u3055\u308C\u305F\u30D7\u30ED\u30D1\u30C6\u30A3\u3078\u306E\u4EE3\u5165\u306F\u30EA\u30A2\u30AF\u30C6\u30A3\u30D6\u66F4\u65B0\u3092\u30C8\u30EA\u30AC\u30FC\u3057\u307E\u305B\u3093\u3002this["${sp}"] \u3092\u4F7F\u7528\u3057\u3066\u304F\u3060\u3055\u3044\u3002`,
  watchNotObject: () => `$watch \u306F\u300C\u30D1\u30B9 \u2192 \u30CF\u30F3\u30C9\u30E9\u95A2\u6570\u300D\u306E\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059\uFF08\u3053\u306E\u5F62\u306F\u30E9\u30F3\u30BF\u30A4\u30E0\u304C\u8AAD\u307F\u8FBC\u307F\u6642\u306B throw \u3057\u307E\u3059\uFF09`,
  watchKeyCrossState: (k) => `$watch \u306E\u30AD\u30FC "${k}" \u306F\u4ED6\u306E state \u3092\u6307\u3057\u3066\u3044\u307E\u3059\u3002@ \u4ED8\u304D\u306E\u8D8A\u5883 watch \u306F\u4F7F\u3048\u307E\u305B\u3093\uFF08\u81EA state \u306E\u30D1\u30B9\u306E\u307F\uFF09`,
  watchKeyReserved: (k) => `$watch \u306E\u30AD\u30FC "${k}" \u306F "$" \u3067\u59CB\u3081\u3089\u308C\u307E\u305B\u3093\uFF08\u4E88\u7D04\u540D\u524D\u7A7A\u9593\uFF09`,
  watchKeyEmptySegment: (k) => `$watch \u306E\u30AD\u30FC "${k}" \u306B\u7A7A\u306E\u30D1\u30B9\u30BB\u30B0\u30E1\u30F3\u30C8\u304C\u3042\u308A\u307E\u3059`,
  watchHandlerNotFunction: (k) => `$watch \u306E\u30A8\u30F3\u30C8\u30EA "${k}" \u306E\u5024\u306F\u95A2\u6570\u3067\u3042\u308B\u5FC5\u8981\u304C\u3042\u308A\u307E\u3059`,
  watchPathMissing: (k) => `$watch \u306E\u30AD\u30FC "${k}" \u306F\u72B6\u614B\u5B9A\u7FA9\u306B\u5B58\u5728\u3057\u307E\u305B\u3093\uFF08\u4E00\u5EA6\u3082\u767A\u706B\u3057\u307E\u305B\u3093\uFF09`,
  typeAnnotationIncompatible: (vt, rt) => `\u578B "${vt}" \u306F @type {${rt}} \u3068\u4E92\u63DB\u6027\u304C\u3042\u308A\u307E\u305B\u3093`,
  arrayMutation: (m, alt) => `\u914D\u5217\u306E\u7834\u58CA\u7684\u30E1\u30BD\u30C3\u30C9 "${m}" \u306F\u30EA\u30A2\u30AF\u30C6\u30A3\u30D6\u66F4\u65B0\u3092\u30C8\u30EA\u30AC\u30FC\u3057\u307E\u305B\u3093\uFF08\u540C\u4E00\u53C2\u7167\u306E\u81EA\u5DF1\u518D\u4EE3\u5165\u3067\u3082\u8981\u7D20\u306E\u8FFD\u52A0\u30FB\u524A\u9664\u306F\u53CD\u6620\u3055\u308C\u307E\u305B\u3093\uFF09\u3002\u975E\u7834\u58CA\u30E1\u30BD\u30C3\u30C9\u3068\u518D\u4EE3\u5165\u3092\u4F7F\u7528\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u4F8B: ${alt}\uFF09\u3002`,
  arrayIndexAssign: (sp) => `\u914D\u5217\u30A4\u30F3\u30C7\u30C3\u30AF\u30B9\u3078\u306E\u76F4\u63A5\u4EE3\u5165\u306F\u30EA\u30A2\u30AF\u30C6\u30A3\u30D6\u66F4\u65B0\u3092\u30C8\u30EA\u30AC\u30FC\u3057\u307E\u305B\u3093\u3002this["${sp}"] \u306E\u3088\u3046\u306A\u30C9\u30C3\u30C8\u30D1\u30B9\u4EE3\u5165\u3001\u307E\u305F\u306F with() \u3068\u518D\u4EE3\u5165\u3092\u4F7F\u7528\u3057\u3066\u304F\u3060\u3055\u3044\u3002`,
  tagMemberUnknown: (prop, tag) => `"${prop}" \u306F <${tag}> \u306E wcBindable \u30E1\u30F3\u30D0\u30FC\u3067\u306F\u3042\u308A\u307E\u305B\u3093\uFF08\u672A\u77E5\u30E1\u30F3\u30D0\u30FC\u3078\u306E\u30D0\u30A4\u30F3\u30C9\u306F\u9ED9\u3063\u3066\u7121\u8996\u3055\u308C\u307E\u3059\uFF09`,
  tagCommandUnknown: (name, tag, declared) => `"${name}" \u306F <${tag}> \u306E command \u3067\u306F\u3042\u308A\u307E\u305B\u3093\uFF08\u5BA3\u8A00\u6E08\u307F: ${declared}\uFF09`,
  tagEventTokenKeyUnknown: (name, tag, declared) => `eventToken \u306E\u30AD\u30FC "${name}" \u306F <${tag}> \u306E wcBindable \u30D7\u30ED\u30D1\u30C6\u30A3\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002\u751F DOM \u30A4\u30D9\u30F3\u30C8\u540D\u306F\u767A\u706B\u3057\u307E\u305B\u3093 \u2014 \u30D7\u30ED\u30D1\u30C6\u30A3\u540D\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u5BA3\u8A00\u6E08\u307F: ${declared}\uFF09`,
  didYouMean: (c) => `\u3002\u3082\u3057\u304B\u3057\u3066: "${c}"`,
  none: () => `\u306A\u3057`,
  triggerSeededTruthy: (path) => `trigger \u30D0\u30A4\u30F3\u30C9\u5148 "${path}" \u304C true \u3067\u30B7\u30FC\u30C9\u3055\u308C\u3066\u3044\u307E\u3059\u3002trigger \u306F\u30A8\u30C3\u30B8\u691C\u51FA\u306A\u3057\uFF08truthy \u66F8\u304D\u8FBC\u307F\u3067\u5373\u767A\u706B\u30FBmanual \u3082\u30D0\u30A4\u30D1\u30B9\uFF09\u306E\u305F\u3081\u3001\u30D0\u30A4\u30F3\u30C9\u6642\u306B\u5373\u767A\u706B\u3057\u307E\u3059\u3002false \u3067\u30B7\u30FC\u30C9\u3057\u3066\u304F\u3060\u3055\u3044`,
  storageSeedClobber: (path, raw) => `<wcs-storage> \u306E value \u30D0\u30A4\u30F3\u30C9\u5148 "${path}" \u304C ${raw} \u3067\u30B7\u30FC\u30C9\u3055\u308C\u3066\u3044\u307E\u3059\u3002\u521D\u671F\u66F8\u304D\u623B\u3057\u304C\u4FDD\u5B58\u5024\u3092\u4E0A\u66F8\u304D\u3057\u307E\u3059 \u2014 undefined \u3067\u30B7\u30FC\u30C9\uFF08\`${path}: undefined\`\uFF09\u3059\u308B\u304B manual \u3092\u4ED8\u3051\u3066\u304F\u3060\u3055\u3044`,
  devtoolsAfterState: () => `@wcstack/devtools/auto \u306F @wcstack/state/auto \u3088\u308A\u5148\u306B\u8AAD\u307F\u8FBC\u3093\u3067\u304F\u3060\u3055\u3044\uFF08\u5F8C\u3060\u3068\u914D\u7DDA\u53F0\u5E33\u304C\u30E9\u30A4\u30D6\u3067 captured \u3055\u308C\u307E\u305B\u3093\uFF09`,
  baseHrefMissing: () => `@wcstack/router \u3092\u4F7F\u3046 SPA \u306B\u306F <head> \u5185\u306E <base href="/"> \u304C\u5FC5\u8981\u3067\u3059\uFF08\u7121\u3044\u3068\u30C7\u30A3\u30FC\u30D7\u30EA\u30F3\u30AF\u3067 basename \u304C\u8AA4\u5C0E\u51FA\u3055\u308C\u307E\u3059\uFF09`,
  signalsDualEntry: () => `@wcstack/signals \u3068 @wcstack/signals/dom \u304C\u540C\u4E00\u30DA\u30FC\u30B8\u304B\u3089 import \u3055\u308C\u3066\u3044\u307E\u3059\u3002CDN \u3067\u306F\u5404\u30A8\u30F3\u30C8\u30EA\u304C\u81EA\u5DF1\u5B8C\u7D50\u30D0\u30F3\u30C9\u30EB\u306E\u305F\u3081\u30EA\u30A2\u30AF\u30C6\u30A3\u30D6\u30B3\u30A2\u304C\u4E8C\u91CD\u5316\u3057\u3001\u5883\u754C\u3067\u53CD\u5FDC\u304C\u58CA\u308C\u307E\u3059 \u2014 \u3059\u3079\u3066 /dom \u30A8\u30F3\u30C8\u30EA\u304B\u3089 import \u3057\u3066\u304F\u3060\u3055\u3044`
};
var EN_EXPECTED_LABEL = {
  array: "an array-typed path",
  boolean: "a boolean",
  string: "a string"
};
var en = {
  spreadFilterNotAllowed: () => `Filters cannot be applied to a spread target`,
  spreadTargetRequired: () => `Spread requires a target path`,
  structuralMustBeSingle: (d) => `'${d}' must be the only binding in this attribute (it cannot be combined with ';'; the runtime throws at load time)`,
  eventTokenUndeclared: (t) => `Event token "${t}" is not declared in $eventTokens`,
  commandRhsFormat: () => `The right side of a command binding must be $command.<name> (declared in $commandTokens)`,
  commandTokenUndeclared: (t) => `Command token "${t}" is not declared in $commandTokens`,
  streamPathMissing: (p) => `Path "${p}" does not exist in the $streams declaration`,
  pathMissing: (p) => `Path "${p}" does not exist in the state definition`,
  expansionSuffix: (x) => ` (expanded: ${x})`,
  patternPathOutsideFor: (p) => `Pattern path "${p}" cannot be used outside a <template for>`,
  omittedPathOutsideFor: (p) => `Shorthand path "${p}" cannot be used outside a <template for>`,
  loopIndexOutsideFor: (p) => `Loop index "${p}" cannot be used outside a <template for>`,
  resolvedPathInUi: (p) => `Resolved path "${p}" cannot be used in a UI binding. Use a pattern path instead`,
  handlerFilterNotAllowed: (prop) => `Filters cannot be applied to event handler "${prop}"`,
  typeExpectation: (label, expected, resultType) => `"${label}" requires ${EN_EXPECTED_LABEL[expected]} (current type: ${resultType})`,
  filterUnknown: (n) => `Filter "${n}" is not a built-in filter`,
  filterMinArgs: (n, min, c) => `Filter "${n}" requires at least ${min} argument(s) (${c} given)`,
  filterMaxArgs: (n, max, c) => `Filter "${n}" accepts at most ${max} argument(s) (${c} given)`,
  filterArgType: (n, i, exp, arg, act) => `Argument ${i} of filter "${n}" must be of type ${exp} ("${arg}" is ${act})`,
  filterInputType: (n, accepts, cur) => `Filter "${n}" requires input of type ${accepts} (current type: ${cur})`,
  wcsTextInfo: (e) => `wcs-text binding: ${e}`,
  moustacheFouc: (e) => `{{ }} outside a <template> causes FOUC (the raw template string is visible before binding). Consider the comment syntax <!--@@:${e}--> instead.`,
  nestedAssign: (sp) => `Assigning to a nested property does not trigger a reactive update. Use this["${sp}"] instead.`,
  watchNotObject: () => `$watch must be an object mapping state paths to handler functions (the runtime throws on this shape at load time)`,
  watchKeyCrossState: (k) => `$watch key "${k}" targets another state. Cross-state watching with @ is not supported (own paths only)`,
  watchKeyReserved: (k) => `$watch key "${k}" must not start with "$" (reserved namespace)`,
  watchKeyEmptySegment: (k) => `$watch key "${k}" has an empty path segment`,
  watchHandlerNotFunction: (k) => `The value of $watch entry "${k}" must be a function`,
  watchPathMissing: (k) => `$watch key "${k}" does not exist in the state definition (it will never fire)`,
  typeAnnotationIncompatible: (vt, rt) => `Type "${vt}" is not compatible with @type {${rt}}`,
  arrayMutation: (m, alt) => `Destructive array method "${m}" does not trigger a reactive update (re-assigning the same reference does not reflect added/removed elements either). Use a non-destructive method with reassignment (e.g. ${alt}).`,
  arrayIndexAssign: (sp) => `Assigning directly to an array index does not trigger a reactive update. Use a dot-path assignment like this["${sp}"], or with() plus reassignment.`,
  tagMemberUnknown: (prop, tag) => `"${prop}" is not a wcBindable member of <${tag}> (bindings to unknown members are silently ignored)`,
  tagCommandUnknown: (name, tag, declared) => `"${name}" is not a command of <${tag}> (declared: ${declared})`,
  tagEventTokenKeyUnknown: (name, tag, declared) => `eventToken key "${name}" is not a wcBindable property of <${tag}>. Raw DOM event names never fire \u2014 use the property name (declared: ${declared})`,
  didYouMean: (c) => `. Did you mean "${c}"?`,
  none: () => `none`,
  triggerSeededTruthy: (path) => `The trigger-bound slot "${path}" is seeded with true. trigger has no edge detection (any truthy write fires, and it bypasses manual), so it fires immediately at bind. Seed it with false`,
  storageSeedClobber: (path, raw) => `The <wcs-storage> value-bound slot "${path}" is seeded with ${raw}. The initial write-back overwrites the persisted value \u2014 seed it with undefined (\`${path}: undefined\`) or add manual`,
  devtoolsAfterState: () => `Load @wcstack/devtools/auto BEFORE @wcstack/state/auto (otherwise the wiring ledger is not captured live)`,
  baseHrefMissing: () => `An SPA using @wcstack/router needs <base href="/"> in <head> (without it, deep links misderive the basename)`,
  signalsDualEntry: () => `Both @wcstack/signals and @wcstack/signals/dom are imported on this page. On a CDN each entry is a self-contained bundle, so the reactive core is duplicated and reactivity breaks at the seam \u2014 import everything from the single /dom entry`
};
var CATALOGS = { ja, en };
function getMessages(locale) {
  return CATALOGS[resolveLocale(locale)];
}

// src/service/bindingValidator.ts
var filterMap = new Map(BUILTIN_FILTERS.map((f) => [f.name, f]));
function validateBindings(html, attrName, stateTagName = "wcs-state", locale, fileReader) {
  const diagnostics = [];
  const msgs = getMessages(locale);
  const statePaths = getStatePathsFromHtml(html, stateTagName, fileReader);
  const pathsByState = /* @__PURE__ */ new Map();
  for (const p of statePaths) {
    const list = pathsByState.get(p.stateName) ?? [];
    list.push(p);
    pathsByState.set(p.stateName, list);
  }
  const attrs = findAllBindAttributes(html, attrName);
  let structuralTemplates = null;
  const getStructuralTemplates = () => {
    structuralTemplates ??= collectStructuralTemplates(html, attrName);
    return structuralTemplates;
  };
  const filterNameSet = new Set(BUILTIN_FILTERS.map((f) => f.name));
  for (const attr of attrs) {
    const bindings = splitBindingExpressions(attr.value);
    const nonEmptyCount = bindings.filter((b) => b.trim().length > 0).length;
    if (nonEmptyCount > 1) {
      let scanPos = 0;
      for (const b of bindings) {
        const colon = b.indexOf(":");
        const prop = (colon === -1 ? b : b.slice(0, colon)).trim();
        if (STRUCTURAL_BINDING_TYPE_SET.has(prop)) {
          const leading = b.length - b.trimStart().length;
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: attr.valueStart + scanPos + leading,
            end: attr.valueStart + scanPos + b.trimEnd().length,
            message: msgs.structuralMustBeSingle(prop),
            severity: "error"
          });
        }
        scanPos += b.length + 1;
      }
    }
    let pos = 0;
    for (const binding of bindings) {
      const bindingStart = attr.valueStart + pos;
      const parsed = parseBindingExpression(binding);
      const scopedPaths = pathsByState.get(parsed.targetState) ?? [];
      const scopedPathSet = new Set(scopedPaths.map((p) => p.path));
      const propNoMod = parsed.property.replace(/#.*$/, "").trim();
      if (propNoMod === "...") {
        for (const filter of parsed.filters) {
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: bindingStart + filter.offset,
            end: bindingStart + filter.offset + filter.name.length,
            message: msgs.spreadFilterNotAllowed(),
            severity: "error"
          });
        }
        if (!parsed.path || parsed.path.trim() === "") {
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: bindingStart,
            end: bindingStart + binding.length,
            message: msgs.spreadTargetRequired(),
            severity: "error"
          });
        }
      }
      if (propNoMod.startsWith("eventToken.")) {
        const tokenNames = new Set(
          scopedPaths.filter((p) => p.kind === "eventToken").map((p) => p.path)
        );
        const tokenName = parsed.path?.trim() ?? "";
        if (tokenName && tokenNames.size > 0 && !tokenNames.has(tokenName)) {
          const pathOffset = binding.indexOf(parsed.path);
          const pathStart = bindingStart + pathOffset;
          diagnostics.push({
            code: WcsDiagnosticCode.TokenUndeclared,
            start: pathStart,
            end: pathStart + tokenName.length,
            message: msgs.eventTokenUndeclared(tokenName),
            severity: "warning"
          });
        }
        pos += binding.length + 1;
        continue;
      }
      const commandNames = new Set(
        scopedPaths.filter((p) => p.kind === "command").map((p) => p.path)
      );
      if (propNoMod.startsWith("command.")) {
        const tokenPath = parsed.path?.trim() ?? "";
        if (tokenPath) {
          const pathOffset = binding.indexOf(parsed.path);
          const pathStart = bindingStart + pathOffset;
          if (!tokenPath.startsWith("$command.")) {
            diagnostics.push({
              code: WcsDiagnosticCode.TokenMisconfigured,
              start: pathStart,
              end: pathStart + tokenPath.length,
              message: msgs.commandRhsFormat(),
              severity: "warning"
            });
          } else if (commandNames.size > 0 && !commandNames.has(tokenPath)) {
            diagnostics.push({
              code: WcsDiagnosticCode.TokenUndeclared,
              start: pathStart,
              end: pathStart + tokenPath.length,
              message: msgs.commandTokenUndeclared(tokenPath),
              severity: "warning"
            });
          }
        }
        pos += binding.length + 1;
        continue;
      }
      if (parsed.path && scopedPaths.length > 0) {
        const pathTrimmed = parsed.path.trim();
        if (pathTrimmed && !isLiteral(pathTrimmed)) {
          let checkPath = pathTrimmed;
          if (pathTrimmed.startsWith(".")) {
            const forPath = getInnermostForPath(html, attr.valueStart, attrName);
            if (forPath && !forPath.startsWith(".")) {
              checkPath = pathTrimmed === "." ? `${forPath}.*` : `${forPath}.*.${pathTrimmed.slice(1)}`;
            } else {
              checkPath = "";
            }
          }
          if (checkPath) {
            const message = validatePathExistence(checkPath, pathTrimmed, scopedPaths, scopedPathSet, commandNames, msgs);
            if (message) {
              const pathOffset = binding.indexOf(parsed.path);
              const pathStart = bindingStart + pathOffset;
              diagnostics.push({
                code: WcsDiagnosticCode.BindingPathMissing,
                start: pathStart,
                end: pathStart + pathTrimmed.length,
                message: `${message}${pathTrimmed.startsWith(".") ? msgs.expansionSuffix(checkPath) : ""}`,
                severity: "warning"
              });
            }
          }
        }
      }
      if (parsed.path) {
        const pathTrimmed = parsed.path.trim();
        const prop = parsed.property.replace(/#.*$/, "");
        const insideFor = isInsideForTemplate(html, attr.valueStart, attrName);
        if (pathTrimmed && !prop.startsWith("on")) {
          if (!insideFor && pathTrimmed.includes("*")) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: msgs.patternPathOutsideFor(pathTrimmed),
              severity: "warning"
            });
          }
          if (!insideFor && pathTrimmed.startsWith(".")) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: msgs.omittedPathOutsideFor(pathTrimmed),
              severity: "warning"
            });
          }
          if (!insideFor && /^\$\d+$/.test(pathTrimmed)) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: msgs.loopIndexOutsideFor(pathTrimmed),
              severity: "warning"
            });
          }
          if (/\.\d+\.|\.\d+$/.test(pathTrimmed)) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: msgs.resolvedPathInUi(pathTrimmed),
              severity: "warning"
            });
          }
        }
      }
      if (propNoMod === "...") {
      } else if (parsed.property.startsWith("on") && parsed.filters.length > 0) {
        for (const filter of parsed.filters) {
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: bindingStart + filter.offset,
            end: bindingStart + filter.offset + filter.name.length,
            message: msgs.handlerFilterNotAllowed(parsed.property),
            severity: "warning"
          });
        }
      } else {
        for (const filter of parsed.filters) {
          diagnostics.push(...validateFilterUsage(filter, bindingStart, msgs));
        }
        if (parsed.path && statePaths.length > 0) {
          const pathTrimmed = parsed.path.trim();
          if (pathTrimmed && !pathTrimmed.startsWith(".") && !isLiteral(pathTrimmed)) {
            const chainDiags = validateFilterChainTypes(
              pathTrimmed,
              parsed.filters,
              scopedPaths,
              bindingStart,
              msgs
            );
            diagnostics.push(...chainDiags);
          }
        }
      }
      for (const filter of parsed.inputFilters) {
        diagnostics.push(...validateFilterUsage(filter, bindingStart, msgs));
      }
      if (parsed.path && scopedPaths.length > 0) {
        const pathTrimmed = parsed.path.trim();
        if (pathTrimmed && !pathTrimmed.startsWith(".") && !isLiteral(pathTrimmed)) {
          const resultType = resolveResultType(pathTrimmed, parsed.filters, scopedPaths);
          if (resultType !== null) {
            const typeReq = getExpectedType(
              parsed.property,
              () => isNegatedByElseChain(getStructuralTemplates(), attr.valueStart)
            );
            if (typeReq && resultType !== typeReq.expected) {
              const pathOffset = binding.indexOf(parsed.path);
              const pathStart = bindingStart + pathOffset;
              diagnostics.push({
                code: WcsDiagnosticCode.BindingTypeExpectation,
                start: pathStart,
                end: pathStart + pathTrimmed.length,
                message: msgs.typeExpectation(typeReq.label, typeReq.expected, resultType),
                severity: typeReq.severity
              });
            }
          }
        }
      }
      pos += binding.length + 1;
    }
  }
  return diagnostics;
}
function findAllBindAttributes(html, attrName) {
  const attrs = [];
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*=\\s*(["'])`, "gi");
  let match;
  while ((match = regex.exec(html)) !== null) {
    const quote = match[1];
    const valueStart = match.index + match[0].length;
    const valueEnd = html.indexOf(quote, valueStart);
    if (valueEnd === -1) continue;
    attrs.push({
      value: html.slice(valueStart, valueEnd),
      valueStart
    });
  }
  return attrs;
}
function splitBindingExpressions(value) {
  const result = [];
  let current = "";
  let parenDepth = 0;
  for (const ch of value) {
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === ";" && parenDepth === 0) {
      result.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}
function parseBindingExpression(expr) {
  const colonIndex = expr.indexOf(":");
  if (colonIndex === -1) {
    return { property: expr.trim(), path: null, targetState: "default", filters: [], inputFilters: [] };
  }
  const rawProp = expr.slice(0, colonIndex);
  const propSegments = splitByPipe(rawProp);
  const property = propSegments[0].trim();
  const inputFilters = parseFilterSegments(expr, propSegments.slice(1), propSegments[0].length + 1);
  const afterColon = expr.slice(colonIndex + 1);
  const segments = splitByPipe(afterColon);
  const pathSegment = segments[0] || "";
  const filterSegments = segments.slice(1);
  const atIndex = pathSegment.indexOf("@");
  const path = atIndex !== -1 ? pathSegment.slice(0, atIndex) : pathSegment;
  const targetState = atIndex !== -1 ? pathSegment.slice(atIndex + 1).trim() || "default" : "default";
  const filters = parseFilterSegments(expr, filterSegments, colonIndex + 1 + pathSegment.length + 1);
  return { property, path: path.trim() || null, targetState, filters, inputFilters };
}
function parseFilterSegments(expr, segments, searchStart) {
  const filters = [];
  let filterSearchStart = searchStart;
  for (const seg of segments) {
    const trimmed = seg.trim();
    const filterMatch = trimmed.match(/^(\w+)(?:\(([^)]*)\))?/);
    if (filterMatch) {
      const nameOffset = expr.indexOf(trimmed, filterSearchStart);
      const args = filterMatch[2] !== void 0 ? filterMatch[2].split(",").map((a) => a.trim()).filter((a) => a !== "") : [];
      filters.push({
        name: filterMatch[1],
        offset: nameOffset >= 0 ? nameOffset : filterSearchStart,
        args,
        argsOffset: nameOffset >= 0 ? nameOffset + filterMatch[1].length : filterSearchStart
      });
    }
    filterSearchStart += seg.length + 1;
  }
  return filters;
}
function validateFilterUsage(filter, bindingStart, msgs) {
  const diagnostics = [];
  const info = filterMap.get(filter.name);
  if (!info) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterUnknown,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: msgs.filterUnknown(filter.name),
      severity: "warning"
    });
    return diagnostics;
  }
  const argCount = filter.args.length;
  if (argCount < info.minArgs) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterArity,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: msgs.filterMinArgs(filter.name, info.minArgs, argCount),
      severity: "error"
    });
  } else if (argCount > info.maxArgs) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterArity,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: msgs.filterMaxArgs(filter.name, info.maxArgs, argCount),
      severity: "error"
    });
  }
  if (info.argTypes && argCount > 0) {
    for (let i = 0; i < Math.min(argCount, info.argTypes.length); i++) {
      const expectedArgType = info.argTypes[i];
      if (expectedArgType === "any") continue;
      const actualArgType = inferArgType(filter.args[i]);
      if (actualArgType !== expectedArgType) {
        diagnostics.push({
          code: WcsDiagnosticCode.FilterArgType,
          start: bindingStart + filter.argsOffset,
          end: bindingStart + filter.argsOffset + filter.name.length,
          message: msgs.filterArgType(filter.name, i + 1, expectedArgType, filter.args[i], actualArgType),
          severity: "warning"
        });
      }
    }
  }
  return diagnostics;
}
function splitByPipe(value) {
  const result = [];
  let current = "";
  let parenDepth = 0;
  for (const ch of value) {
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === "|" && parenDepth === 0) {
      result.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}
function validatePathExistence(checkPath, displayPath, scopedPaths, scopedPathSet, commandNames, msgs) {
  if (/^\$\d+$/.test(checkPath)) return null;
  if (checkPath.startsWith("$command.")) {
    if (commandNames.size > 0 && !commandNames.has(checkPath)) {
      return msgs.commandTokenUndeclared(displayPath);
    }
    return null;
  }
  if (checkPath.startsWith("$streamStatus.") || checkPath.startsWith("$streamError.")) {
    const prefix = checkPath.startsWith("$streamStatus.") ? "$streamStatus." : "$streamError.";
    const hasNamespace = scopedPaths.some((p) => p.path.startsWith(prefix));
    if (hasNamespace && !scopedPathSet.has(checkPath)) {
      return msgs.streamPathMissing(displayPath);
    }
    return null;
  }
  if (!scopedPathSet.has(checkPath)) {
    return msgs.pathMissing(displayPath);
  }
  return null;
}
function collectStructuralTemplates(html, attrName) {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attrRegex = new RegExp(`${escaped}\\s*=\\s*(["'])`, "i");
  const tagRegex = /<template(?:\s[^>]*)?>|<\/template\s*>/gi;
  const templates = [];
  let depth = 0;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match[0].startsWith("</")) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const attrMatch = attrRegex.exec(match[0]);
    if (attrMatch) {
      const quote = attrMatch[1];
      const valueStart = match.index + attrMatch.index + attrMatch[0].length;
      const valueEnd = html.indexOf(quote, valueStart);
      if (valueEnd !== -1) {
        const first = splitBindingExpressions(html.slice(valueStart, valueEnd))[0] ?? "";
        const prop = first.split(":")[0].replace(/#.*$/, "").trim();
        const type = prop === "if" || prop === "elseif" || prop === "else" ? prop : "other";
        templates.push({ valueStart, depth, type });
      }
    }
    depth++;
  }
  return templates;
}
function isNegatedByElseChain(templates, valueStart) {
  const index = templates.findIndex((t) => t.valueStart === valueStart);
  if (index === -1) return false;
  const selfDepth = templates[index].depth;
  for (let i = index + 1; i < templates.length; i++) {
    const next = templates[i];
    if (next.depth > selfDepth) continue;
    if (next.depth < selfDepth) return false;
    if (next.type === "elseif" || next.type === "else") return true;
    if (next.type === "if") return false;
  }
  return false;
}
function getExpectedType(property, isNegatedIf) {
  const prop = property.replace(/#.*$/, "");
  if (prop === "for") {
    return { label: "for", expected: "array", severity: "error" };
  }
  if (prop === "if" || prop === "elseif") {
    if (!isNegatedIf()) return null;
    return { label: prop, expected: "boolean", severity: "warning" };
  }
  if (prop.startsWith("class.")) {
    return { label: prop, expected: "boolean", severity: "warning" };
  }
  if (prop.startsWith("attr.")) {
    return { label: prop, expected: "string", severity: "warning" };
  }
  if (prop.startsWith("style.")) {
    return { label: prop, expected: "string", severity: "warning" };
  }
  return null;
}
function validateFilterChainTypes(path, filters, statePaths, bindingStart, msgs) {
  const diagnostics = [];
  const pathInfo = statePaths.find((p) => p.path === path);
  if (!pathInfo?.typeHint) return diagnostics;
  let currentType = pathInfo.typeHint;
  for (const filter of filters) {
    const info = filterMap.get(filter.name);
    if (!info) break;
    if (info.acceptTypes !== "any") {
      const currentTypes = currentType.split("|");
      const hasMatch = currentTypes.some((t) => info.acceptTypes.includes(t));
      if (!hasMatch) {
        diagnostics.push({
          code: WcsDiagnosticCode.FilterInputType,
          start: bindingStart + filter.offset,
          end: bindingStart + filter.offset + filter.name.length,
          message: msgs.filterInputType(filter.name, info.acceptTypes.join("|"), currentType),
          severity: "warning"
        });
      }
    }
    if (info.resultType !== "passthrough") {
      currentType = info.resultType;
    }
  }
  return diagnostics;
}
function resolveResultType(path, filters, statePaths) {
  const pathInfo = statePaths.find((p) => p.path === path);
  if (!pathInfo?.typeHint) return null;
  let currentType = pathInfo.typeHint;
  for (const filter of filters) {
    const info = filterMap.get(filter.name);
    if (!info) return null;
    if (info.resultType === "passthrough") continue;
    currentType = info.resultType;
  }
  return currentType;
}
function inferArgType(arg) {
  const v = arg.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return "number";
  return "string";
}
function isLiteral(value) {
  return /^-?\d/.test(value) || /^["'`]/.test(value) || value === "true" || value === "false" || value === "null";
}

// src/service/stateTypeValidator.ts
function validateStateTypes(html, stateTagName = "wcs-state", locale) {
  const msgs = getMessages(locale);
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  const diagnostics = [];
  for (const block of blocks) {
    const props = findJsDocTypedProperties(block.content);
    for (const prop of props) {
      if (!isValueCompatible(prop.declaredTypes, prop.valueType)) {
        const absStart = block.contentStart + prop.valueOffset;
        const absEnd = absStart + prop.valueLength;
        diagnostics.push({
          start: absStart,
          end: absEnd,
          message: msgs.typeAnnotationIncompatible(prop.valueType, prop.rawType),
          severity: "warning"
        });
      }
    }
  }
  return diagnostics;
}
function findJsDocTypedProperties(script) {
  const results = [];
  const regex = /\/\*\*\s*@type\s*\{([^}]+)\}\s*\*\/\s*(?:"([^"]+)"|'([^']+)'|(\w+))\s*:\s*/g;
  let match;
  while ((match = regex.exec(script)) !== null) {
    const rawType = match[1].trim();
    const name = match[2] ?? match[3] ?? match[4];
    const valueStart = match.index + match[0].length;
    const valueText = extractValue(script, valueStart);
    const valueType = inferValueType(valueText);
    if (valueType) {
      const declaredTypes = rawType.split("|").map((t) => normalizeType(t.trim()));
      results.push({
        name,
        rawType,
        declaredTypes,
        valueType,
        valueOffset: valueStart,
        valueLength: valueText.length
      });
    }
  }
  return results;
}
function extractValue(script, start) {
  let depth = 0;
  let inString = null;
  let i = start;
  while (i < script.length) {
    const ch = script[i];
    if (inString) {
      if (ch === inString && script[i - 1] !== "\\") inString = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if ((ch === "," || ch === "\n") && depth === 0) {
      break;
    }
    i++;
  }
  return script.slice(start, i).trim();
}
function inferValueType(value) {
  const v = value.replace(/,\s*$/, "").trim();
  if (v === "null") return "null";
  if (v === "undefined") return "null";
  if (v === "true" || v === "false") return "boolean";
  if (/^-?\d+\.\d/.test(v)) return "number";
  if (/^-?\d/.test(v)) return "number";
  if (/^["'`]/.test(v)) return "string";
  if (v.startsWith("[")) return "array";
  if (v.startsWith("{")) return "object";
  return null;
}
function normalizeType(type) {
  const lower = type.toLowerCase();
  if (lower === "null" || lower === "undefined") return "null";
  if (lower === "string") return "string";
  if (lower === "number") return "number";
  if (lower === "boolean") return "boolean";
  if (lower.endsWith("[]") || lower.startsWith("array")) return "array";
  if (lower === "object") return "object";
  return type;
}
function isValueCompatible(declaredTypes, valueType) {
  return declaredTypes.includes(valueType);
}

// src/service/scriptPatterns.ts
var ID = String.raw`[\w$]+`;
var SUB = String.raw`\s*(?:\?\.)?\s*\[(?!\s*["'])[^\[\]]+\]`;
var DOT_SEG = String.raw`\s*\??\.\s*${ID}`;
var CHAIN = String.raw`(?:${DOT_SEG}|${SUB})*`;
var BRACKETS_ONLY = String.raw`(?:${SUB})+`;
var CHAIN_ONE_PLUS = String.raw`(?:${DOT_SEG}|${SUB})+`;
var ROOT_DOT = String.raw`\bthis\s*\??\.\s*(${ID})`;
var ROOT_BRACKET = String.raw`\bthis\s*(?:\?\.)?\s*\[\s*["']([^"']+)["']\s*\]`;
var ASSIGN_TAIL = String.raw`\s*(?:(?:\*\*|<<|>>>|>>|&&|\|\||\?\?|[+\-*/%&|^])?=(?!=)|\+\+|--)`;
var PRE_INCDEC = String.raw`(?:\+\+|--)\s*`;
function chainToDotted(chain) {
  const token = new RegExp(String.raw`\s*(?:\??\.\s*(${ID})|(?:\?\.)?\s*\[([^\[\]]+)\])`, "g");
  let out = "";
  let match;
  while ((match = token.exec(chain)) !== null) {
    if (match[1] !== void 0) {
      out += `.${match[1]}`;
    } else {
      const key = match[2].trim();
      out += /^\d+$/.test(key) ? `.${key}` : `.<${key}>`;
    }
  }
  return out;
}
function hasDotSegment(chain) {
  return /[.]/.test(chain.replace(/\s*(?:\?\.)?\s*\[[^\[\]]+\]/g, ""));
}
function isApiRoot(root) {
  return root.startsWith("$");
}

// src/service/nestedAssignValidator.ts
var NESTED_ASSIGN = new RegExp(`${ROOT_DOT}(${CHAIN_ONE_PLUS})${ASSIGN_TAIL}`, "g");
var PRE_NESTED_INCDEC = new RegExp(`${PRE_INCDEC}${ROOT_DOT}(${CHAIN_ONE_PLUS})`, "g");
function validateNestedAssigns(html, stateTagName = "wcs-state", locale) {
  const msgs = getMessages(locale);
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  const diagnostics = [];
  for (const block of blocks) {
    findNestedAssigns(block.content, block.contentStart, msgs, diagnostics);
  }
  return diagnostics;
}
function findNestedAssigns(script, baseOffset, msgs, out) {
  for (const regex of [NESTED_ASSIGN, PRE_NESTED_INCDEC]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(script)) !== null) {
      const [full, topProp, chainPart] = match;
      if (isApiRoot(topProp)) continue;
      if (!hasDotSegment(chainPart)) continue;
      const suggestedPath = topProp + chainToDotted(chainPart);
      const start = baseOffset + match.index;
      out.push({
        start,
        end: start + full.length,
        message: msgs.nestedAssign(suggestedPath),
        severity: "warning"
      });
    }
  }
}

// src/service/arrayMutationValidator.ts
var DESTRUCTIVE_METHODS = "push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin";
var ALTERNATIVES = {
  push: (a) => `${a} = ${a}.concat(item)`,
  unshift: (a) => `${a} = [item, ...${a}]`,
  pop: (a) => `${a} = ${a}.slice(0, -1)`,
  shift: (a) => `${a} = ${a}.slice(1)`,
  splice: (a) => `${a} = ${a}.toSpliced(...)`,
  sort: (a) => `${a} = ${a}.toSorted(...)`,
  reverse: (a) => `${a} = ${a}.toReversed()`,
  fill: (a) => `${a} = ${a}.map(...)`,
  copyWithin: (a) => `${a} = ${a}.map(...)`
};
var METHOD_TAIL = String.raw`\s*\??\.\s*(${DESTRUCTIVE_METHODS})(?=\s*\()`;
var DOT_ROOT_CALL = new RegExp(`${ROOT_DOT}(${CHAIN})${METHOD_TAIL}`, "g");
var BRACKET_ROOT_CALL = new RegExp(`${ROOT_BRACKET}(${CHAIN})${METHOD_TAIL}`, "g");
var DOT_INDEX_ASSIGN = new RegExp(`${ROOT_DOT}(${BRACKETS_ONLY})${ASSIGN_TAIL}`, "g");
var BRACKET_INDEX_ASSIGN = new RegExp(`${ROOT_BRACKET}(${BRACKETS_ONLY})${ASSIGN_TAIL}`, "g");
var PRE_DOT_INDEX = new RegExp(`${PRE_INCDEC}${ROOT_DOT}(${BRACKETS_ONLY})`, "g");
var PRE_BRACKET_INDEX = new RegExp(`${PRE_INCDEC}${ROOT_BRACKET}(${BRACKETS_ONLY})`, "g");
function toAccessor(path) {
  return /^[A-Za-z_]\w*$/.test(path) ? `this.${path}` : `this["${path}"]`;
}
function validateArrayMutations(html, stateTagName = "wcs-state", locale) {
  const msgs = getMessages(locale);
  const blocks = parseWcsScriptBlocks(html, stateTagName);
  const diagnostics = [];
  for (const block of blocks) {
    findDestructiveCalls(block.content, block.contentStart, msgs, diagnostics);
    findIndexAssigns(block.content, block.contentStart, msgs, diagnostics);
  }
  return diagnostics;
}
function findDestructiveCalls(script, baseOffset, msgs, out) {
  for (const regex of [DOT_ROOT_CALL, BRACKET_ROOT_CALL]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(script)) !== null) {
      const [full, root, chain, method] = match;
      if (isApiRoot(root)) continue;
      const statePath = root + chainToDotted(chain);
      const start = baseOffset + match.index;
      out.push({
        code: WcsDiagnosticCode.ArrayMutation,
        start,
        end: start + full.length,
        message: msgs.arrayMutation(method, ALTERNATIVES[method](toAccessor(statePath))),
        severity: "warning",
        statePath
      });
    }
  }
}
function findIndexAssigns(script, baseOffset, msgs, out) {
  for (const regex of [DOT_INDEX_ASSIGN, BRACKET_INDEX_ASSIGN, PRE_DOT_INDEX, PRE_BRACKET_INDEX]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(script)) !== null) {
      const [full, root, chain] = match;
      if (isApiRoot(root)) continue;
      const suggestedPath = root + chainToDotted(chain);
      const start = baseOffset + match.index;
      out.push({
        code: WcsDiagnosticCode.ArrayIndexAssign,
        start,
        end: start + full.length,
        message: msgs.arrayIndexAssign(suggestedPath),
        severity: "warning",
        statePath: suggestedPath
      });
    }
  }
}

// src/service/templateSyntax.ts
function findAllMustacheSyntax(html) {
  const results = [];
  const regex = /\{\{\s*(.+?)\s*\}\}/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    if (isInsideTag(html, match.index, "script") || isInsideTag(html, match.index, "style")) {
      continue;
    }
    const expr = match[1];
    const exprStart = match.index + match[0].indexOf(expr);
    results.push({
      kind: "mustache",
      expression: expr,
      exprStart,
      exprEnd: exprStart + expr.length,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
      insideTemplate: isInsideTag(html, match.index, "template")
    });
  }
  return results;
}
function findAllCommentBindings(html, commentTextPrefix = "wcs-text") {
  const results = [];
  const escaped = commentTextPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<!--\\s*@@\\s*(?:${escaped})?\\s*:\\s*(.+?)\\s*-->`, "g");
  let match;
  while ((match = regex.exec(html)) !== null) {
    const expr = match[1];
    if (!expr) continue;
    const exprStart = match.index + match[0].indexOf(expr);
    results.push({
      kind: "comment",
      expression: expr,
      exprStart,
      exprEnd: exprStart + expr.length,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
      insideTemplate: isInsideTag(html, match.index, "template")
    });
  }
  return results;
}
function isInsideTag(html, offset, tagName) {
  const tagRegex = new RegExp(`<(/?)${tagName}[\\s>]`, "gi");
  let depth = 0;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match.index > offset) break;
    if (match[1]) {
      depth = Math.max(0, depth - 1);
    } else {
      depth++;
    }
  }
  return depth > 0;
}

// src/service/templateSyntaxValidator.ts
function validateTemplateSyntax(html, stateTagName, bindAttrName = "data-wcs", locale, fileReader) {
  const diagnostics = [];
  const msgs = getMessages(locale);
  const allPaths = getStatePathsFromHtml(html, stateTagName, fileReader);
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
        message: msgs.wcsTextInfo(item.expression),
        severity: "info"
      });
    }
    if (item.kind === "mustache" && !item.insideTemplate) {
      diagnostics.push({
        code: WcsDiagnosticCode.TemplateSyntax,
        start: item.matchStart,
        end: item.matchEnd,
        message: msgs.moustacheFouc(item.expression),
        severity: "info"
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
          severity: "warning"
        });
      }
      if (!insideFor && pathPart.startsWith(".")) {
        diagnostics.push({
          code: WcsDiagnosticCode.TemplateSyntax,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.omittedPathOutsideFor(pathPart),
          severity: "warning"
        });
      }
      if (/\.\d+\.|\.\d+$/.test(pathPart)) {
        diagnostics.push({
          code: WcsDiagnosticCode.TemplateSyntax,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.resolvedPathInUi(pathPart),
          severity: "warning"
        });
      }
      if (pathPart.startsWith(".")) {
        const forPath = insideFor ? getInnermostForPath(html, item.matchStart, bindAttrName) : null;
        if (forPath && !forPath.startsWith(".")) {
          const expandedPath = pathPart === "." ? `${forPath}.*` : `${forPath}.*.${pathPart.slice(1)}`;
          if (!isValidTemplatePath(expandedPath, pathSet, defaultPaths)) {
            diagnostics.push({
              code: WcsDiagnosticCode.BindingPathMissing,
              start: item.exprStart,
              end: item.exprStart + pathPart.length,
              message: msgs.pathMissing(pathPart) + msgs.expansionSuffix(expandedPath),
              severity: "warning"
            });
          }
        }
      } else if (!isValidTemplatePath(pathPart, pathSet, defaultPaths)) {
        diagnostics.push({
          code: WcsDiagnosticCode.BindingPathMissing,
          start: item.exprStart,
          end: item.exprStart + pathPart.length,
          message: msgs.pathMissing(pathPart),
          severity: "warning"
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
          message: msgs.filterUnknown(filterName),
          severity: "warning"
        });
      }
    }
  }
  return diagnostics;
}
function isValidTemplatePath(path, pathSet, scopedPaths) {
  if (/^\$\d+$/.test(path)) return true;
  if (path.startsWith("$streamStatus.") || path.startsWith("$streamError.")) {
    const prefix = path.startsWith("$streamStatus.") ? "$streamStatus." : "$streamError.";
    const hasNamespace = scopedPaths.some((p) => p.path.startsWith(prefix));
    return !hasNamespace || pathSet.has(path);
  }
  return pathSet.has(path);
}

// src/service/generated/builtinTags.generated.ts
var BUILTIN_TAGS = {
  "wcs-accelerometer": {
    "package": "accelerometer",
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "x",
      "y",
      "z",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-ambient-light-sensor": {
    "package": "ambient-light-sensor",
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "illuminance",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-audio": {
    "package": "audio",
    "observedAttributes": [
      "volume",
      "limiter",
      "resume-on-gesture"
    ],
    "inputs": {
      "volume": "volume",
      "limiter": "limiter",
      "resumeOnGesture": "resume-on-gesture"
    },
    "properties": [
      "state",
      "running",
      "suspended",
      "unsupported",
      "voices",
      "noteOn",
      "noteOff",
      "warnings",
      "error",
      "errorInfo"
    ],
    "commands": [
      "resume",
      "suspend",
      "noteOn",
      "noteOff",
      "allNotesOff"
    ]
  },
  "wcs-voice": {
    "package": "audio",
    "observedAttributes": [
      "poly"
    ],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-osc": {
    "package": "audio",
    "observedAttributes": [
      "frequency",
      "detune",
      "type",
      "glide",
      "transpose",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "frequency": "frequency",
      "detune": "detune",
      "type": "type",
      "glide": "glide",
      "transpose": "transpose"
    },
    "properties": [],
    "commands": []
  },
  "wcs-noise": {
    "package": "audio",
    "observedAttributes": [
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-biquad": {
    "package": "audio",
    "observedAttributes": [
      "frequency",
      "q",
      "gain",
      "detune",
      "type",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "frequency": "frequency",
      "q": "q",
      "gain": "gain",
      "detune": "detune",
      "type": "type"
    },
    "properties": [],
    "commands": []
  },
  "wcs-gain": {
    "package": "audio",
    "observedAttributes": [
      "gain",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "gain": "gain"
    },
    "properties": [],
    "commands": []
  },
  "wcs-delay": {
    "package": "audio",
    "observedAttributes": [
      "time",
      "feedback",
      "mix",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "time": "time",
      "feedback": "feedback",
      "mix": "mix"
    },
    "properties": [],
    "commands": []
  },
  "wcs-shaper": {
    "package": "audio",
    "observedAttributes": [
      "amount",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "amount": "amount"
    },
    "properties": [],
    "commands": []
  },
  "wcs-env": {
    "package": "audio",
    "observedAttributes": [
      "attack",
      "decay",
      "sustain",
      "release",
      "depth",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "attack": "attack",
      "decay": "decay",
      "sustain": "sustain",
      "release": "release",
      "depth": "depth"
    },
    "properties": [],
    "commands": []
  },
  "wcs-lfo": {
    "package": "audio",
    "observedAttributes": [
      "rate",
      "depth",
      "type",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "rate": "rate",
      "depth": "depth",
      "type": "type"
    },
    "properties": [],
    "commands": []
  },
  "wcs-analyser": {
    "package": "audio",
    "observedAttributes": [
      "fft",
      "smoothing",
      "id",
      "out",
      "param",
      "note",
      "master",
      "poly"
    ],
    "inputs": {
      "fft": "fft",
      "smoothing": "smoothing"
    },
    "properties": [
      "frame"
    ],
    "commands": [
      "sample"
    ]
  },
  "wcs-broadcast": {
    "package": "broadcast",
    "observedAttributes": [
      "name"
    ],
    "inputs": {
      "name": "name",
      "manual": "manual"
    },
    "properties": [
      "message",
      "error",
      "errorInfo"
    ],
    "commands": [
      "open",
      "post",
      "close"
    ]
  },
  "wcs-camera": {
    "package": "camera",
    "observedAttributes": [
      "facing-mode",
      "device-id",
      "audio",
      "width",
      "height"
    ],
    "inputs": {
      "audio": "audio",
      "facingMode": "facing-mode",
      "deviceId": "device-id",
      "width": "width",
      "height": "height",
      "autostart": "autostart",
      "keepAlive": "keep-alive"
    },
    "properties": [
      "active",
      "permission",
      "audioPermission",
      "deviceId",
      "devices",
      "error",
      "errorInfo",
      "streamReady",
      "ended"
    ],
    "commands": [
      "start",
      "stop",
      "switchCamera"
    ]
  },
  "wcs-recorder": {
    "package": "camera",
    "observedAttributes": [],
    "inputs": {
      "mimeType": "mime-type",
      "timeslice": "timeslice",
      "audioBitsPerSecond": "audio-bits",
      "videoBitsPerSecond": "video-bits"
    },
    "properties": [
      "recording",
      "paused",
      "duration",
      "mimeType",
      "blob",
      "objectURL",
      "error",
      "errorInfo",
      "recorded",
      "dataavailable"
    ],
    "commands": [
      "attachStream",
      "start",
      "stop",
      "pause",
      "resume"
    ]
  },
  "wcs-clipboard": {
    "package": "clipboard",
    "observedAttributes": [],
    "inputs": {
      "monitor": "monitor"
    },
    "properties": [
      "text",
      "items",
      "loading",
      "error",
      "readPermission",
      "writePermission",
      "monitoring",
      "errorInfo",
      "copied",
      "cut",
      "pasted"
    ],
    "commands": [
      "writeText",
      "write",
      "readText",
      "read",
      "startMonitor",
      "stopMonitor"
    ]
  },
  "wcs-contacts": {
    "package": "contacts",
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "select"
    ]
  },
  "wcs-credential": {
    "package": "credential",
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "get",
      "store"
    ]
  },
  "wcs-debounce": {
    "package": "debounce",
    "observedAttributes": [],
    "inputs": {
      "source": null,
      "wait": "wait",
      "leading": null,
      "trailing": null,
      "maxWait": "max-wait"
    },
    "properties": [
      "value",
      "fired",
      "pending"
    ],
    "commands": [
      "trigger",
      "cancel",
      "flush"
    ]
  },
  "wcs-throttle": {
    "package": "debounce",
    "observedAttributes": [],
    "inputs": {
      "source": null,
      "wait": "wait",
      "leading": null,
      "trailing": null,
      "maxWait": "max-wait"
    },
    "properties": [
      "value",
      "fired",
      "pending"
    ],
    "commands": [
      "trigger",
      "cancel",
      "flush"
    ]
  },
  "wcs-defined": {
    "package": "defined",
    "observedAttributes": [],
    "inputs": {
      "tags": "tags",
      "mode": "mode",
      "timeout": "timeout"
    },
    "properties": [
      "defined",
      "pending",
      "missing",
      "count",
      "total",
      "error"
    ],
    "commands": []
  },
  "wcs-eyedropper": {
    "package": "eyedropper",
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "open",
      "abort"
    ]
  },
  "wcs-fetch": {
    "package": "fetch",
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": null,
      "method": null,
      "target": null,
      "manual": null,
      "body": null,
      "responseType": null,
      "trigger": null
    },
    "properties": [
      "value",
      "loading",
      "error",
      "status",
      "objectURL",
      "errorInfo",
      "trigger"
    ],
    "commands": [
      "fetch",
      "abort"
    ]
  },
  "wcs-fetch-header": {
    "package": "fetch",
    "observedAttributes": [],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-fetch-body": {
    "package": "fetch",
    "observedAttributes": [],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-infinite-scroll": {
    "package": "fetch",
    "observedAttributes": [
      "target",
      "root",
      "root-margin",
      "threshold",
      "disabled"
    ],
    "inputs": {},
    "properties": [],
    "commands": []
  },
  "wcs-fullscreen": {
    "package": "fullscreen",
    "observedAttributes": [
      "target"
    ],
    "inputs": {
      "target": "target"
    },
    "properties": [
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestFullscreen",
      "exitFullscreen"
    ]
  },
  "wcs-geo": {
    "package": "geolocation",
    "observedAttributes": [],
    "inputs": {
      "highAccuracy": "high-accuracy",
      "timeout": "timeout",
      "maximumAge": "maximum-age",
      "watch": "watch",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "position",
      "latitude",
      "longitude",
      "accuracy",
      "coords",
      "timestamp",
      "watching",
      "loading",
      "error",
      "permission",
      "errorInfo",
      "trigger"
    ],
    "commands": [
      "getCurrentPosition",
      "watchPosition",
      "clearWatch"
    ]
  },
  "wcs-gyroscope": {
    "package": "gyroscope",
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "x",
      "y",
      "z",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-idle": {
    "package": "idle",
    "observedAttributes": [],
    "inputs": {
      "threshold": "threshold"
    },
    "properties": [
      "userState",
      "screenState",
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPermission",
      "start",
      "stop"
    ]
  },
  "wcs-intersect": {
    "package": "intersection",
    "observedAttributes": [
      "target",
      "root",
      "root-margin",
      "threshold"
    ],
    "inputs": {
      "target": "target",
      "root": "root",
      "rootMargin": "root-margin",
      "threshold": "threshold",
      "once": "once",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "entry",
      "intersecting",
      "ratio",
      "visible",
      "observing",
      "trigger"
    ],
    "commands": [
      "observe",
      "reobserve",
      "unobserve",
      "disconnect",
      "reset"
    ]
  },
  "wcs-magnetometer": {
    "package": "magnetometer",
    "observedAttributes": [],
    "inputs": {
      "frequency": null
    },
    "properties": [
      "x",
      "y",
      "z",
      "error",
      "errorInfo"
    ],
    "commands": [
      "start",
      "stop"
    ]
  },
  "wcs-midi": {
    "package": "midi",
    "observedAttributes": [
      "input",
      "output",
      "channel"
    ],
    "inputs": {
      "input": "input",
      "output": "output",
      "channel": "channel",
      "sysex": "sysex",
      "auto": "auto"
    },
    "properties": [
      "message",
      "type",
      "channel",
      "note",
      "velocity",
      "control",
      "value",
      "devices",
      "connected",
      "permission",
      "granted",
      "denied",
      "unsupported",
      "error",
      "errorInfo"
    ],
    "commands": [
      "request",
      "close",
      "send"
    ]
  },
  "wcs-network": {
    "package": "network",
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "effectiveType",
      "downlink",
      "rtt",
      "saveData",
      "supported"
    ],
    "commands": []
  },
  "wcs-notify": {
    "package": "notification",
    "observedAttributes": [],
    "inputs": {
      "notice": null,
      "mode": "mode",
      "body": "body",
      "icon": "icon",
      "badge": "badge",
      "tag": "tag",
      "lang": "lang",
      "dir": "dir",
      "requireInteraction": "require-interaction",
      "silent": "silent",
      "renotify": "renotify",
      "manual": "manual"
    },
    "properties": [
      "permission",
      "granted",
      "denied",
      "prompt",
      "unsupported",
      "error",
      "errorInfo",
      "clicked",
      "closed",
      "shown"
    ],
    "commands": [
      "request",
      "notify",
      "close",
      "closeAll"
    ]
  },
  "wcs-permission": {
    "package": "permission",
    "observedAttributes": [],
    "inputs": {
      "name": "name",
      "userVisibleOnly": "user-visible-only",
      "sysex": "sysex"
    },
    "properties": [
      "state",
      "granted",
      "denied",
      "prompt",
      "unsupported"
    ],
    "commands": []
  },
  "wcs-pip": {
    "package": "picture-in-picture",
    "observedAttributes": [
      "target"
    ],
    "inputs": {
      "target": "target"
    },
    "properties": [
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPictureInPicture",
      "exitPictureInPicture"
    ]
  },
  "wcs-pointer-lock": {
    "package": "pointer-lock",
    "observedAttributes": [
      "target"
    ],
    "inputs": {
      "target": "target"
    },
    "properties": [
      "active",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPointerLock",
      "exitPointerLock"
    ]
  },
  "wcs-raf": {
    "package": "raf",
    "observedAttributes": [],
    "inputs": {
      "once": "once",
      "repeat": "repeat",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "tick",
      "elapsed",
      "dt",
      "running",
      "suspended",
      "trigger"
    ],
    "commands": [
      "start",
      "stop",
      "reset",
      "pause",
      "resume"
    ]
  },
  "wcs-resize": {
    "package": "resize",
    "observedAttributes": [
      "target",
      "box",
      "round"
    ],
    "inputs": {
      "target": "target",
      "box": "box",
      "round": "round",
      "once": "once",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "entry",
      "width",
      "height",
      "observing",
      "trigger"
    ],
    "commands": [
      "observe",
      "unobserve",
      "disconnect"
    ]
  },
  "wcs-screen-orientation": {
    "package": "screen-orientation",
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "type",
      "angle",
      "portrait",
      "landscape",
      "error",
      "errorInfo"
    ],
    "commands": [
      "lock",
      "unlock"
    ]
  },
  "wcs-share": {
    "package": "share",
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "value",
      "loading",
      "error",
      "cancelled",
      "errorInfo"
    ],
    "commands": [
      "share"
    ]
  },
  "wcs-speak": {
    "package": "speech",
    "observedAttributes": [],
    "inputs": {
      "say": null,
      "rate": "rate",
      "pitch": "pitch",
      "volume": "volume",
      "voice": "voice",
      "lang": "lang",
      "manual": "manual"
    },
    "properties": [
      "voices",
      "speaking",
      "paused",
      "pending",
      "charIndex",
      "spokenWord",
      "error",
      "errorInfo",
      "unsupported"
    ],
    "commands": [
      "speak",
      "cancel",
      "pause",
      "resume"
    ]
  },
  "wcs-listen": {
    "package": "speech",
    "observedAttributes": [],
    "inputs": {
      "lang": "lang",
      "continuous": "continuous",
      "interim": "interim",
      "maxRestarts": "max-restarts",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "interimTranscript",
      "finalTranscript",
      "result",
      "listening",
      "permission",
      "error",
      "errorInfo",
      "unsupported",
      "trigger"
    ],
    "commands": [
      "start",
      "stop",
      "abort"
    ]
  },
  "wcs-sse": {
    "package": "sse",
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": "url",
      "withCredentials": "with-credentials",
      "events": "events",
      "raw": "raw",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "message",
      "connected",
      "loading",
      "error",
      "errorInfo",
      "readyState",
      "trigger"
    ],
    "commands": [
      "connect",
      "close"
    ]
  },
  "wcs-storage": {
    "package": "storage",
    "observedAttributes": [
      "key",
      "type"
    ],
    "inputs": {
      "key": null,
      "type": null,
      "value": null,
      "manual": null,
      "trigger": null
    },
    "properties": [
      "value",
      "loading",
      "error",
      "errorInfo",
      "trigger"
    ],
    "commands": [
      "load",
      "save",
      "remove"
    ]
  },
  "wcs-tilt": {
    "package": "tilt",
    "observedAttributes": [],
    "inputs": {},
    "properties": [
      "alpha",
      "beta",
      "gamma",
      "absolute",
      "permissionState",
      "error",
      "errorInfo"
    ],
    "commands": [
      "requestPermission",
      "start",
      "stop"
    ]
  },
  "wcs-timer": {
    "package": "timer",
    "observedAttributes": [
      "interval"
    ],
    "inputs": {
      "interval": "interval",
      "once": "once",
      "repeat": "repeat",
      "immediate": "immediate",
      "manual": "manual",
      "trigger": null
    },
    "properties": [
      "tick",
      "elapsed",
      "running",
      "trigger"
    ],
    "commands": [
      "start",
      "stop",
      "reset",
      "pause",
      "resume"
    ]
  },
  "wcs-upload": {
    "package": "upload",
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": null,
      "method": null,
      "fieldName": null,
      "multiple": null,
      "maxSize": null,
      "accept": null,
      "manual": null,
      "files": null,
      "trigger": null
    },
    "properties": [
      "value",
      "loading",
      "progress",
      "error",
      "status",
      "errorInfo",
      "trigger",
      "files"
    ],
    "commands": [
      "upload",
      "abort"
    ]
  },
  "wcs-wakelock": {
    "package": "wakelock",
    "observedAttributes": [
      "active",
      "type"
    ],
    "inputs": {
      "active": "active",
      "type": "type",
      "manual": "manual"
    },
    "properties": [
      "held",
      "error",
      "errorInfo"
    ],
    "commands": [
      "request",
      "release"
    ]
  },
  "wcs-ws": {
    "package": "websocket",
    "observedAttributes": [
      "url"
    ],
    "inputs": {
      "url": "url",
      "protocols": "protocols",
      "autoReconnect": "auto-reconnect",
      "reconnectInterval": "reconnect-interval",
      "maxReconnects": "max-reconnects",
      "binaryType": "binary-type",
      "manual": "manual",
      "trigger": null,
      "send": null
    },
    "properties": [
      "message",
      "connected",
      "loading",
      "error",
      "errorInfo",
      "readyState",
      "trigger",
      "send"
    ],
    "commands": [
      "connect",
      "sendMessage",
      "close"
    ]
  },
  "wcs-worker": {
    "package": "worker",
    "observedAttributes": [
      "src"
    ],
    "inputs": {
      "src": "src",
      "type": "type",
      "name": "name",
      "manual": "manual",
      "keepAlive": "keep-alive",
      "restartOnError": "restart-on-error",
      "maxRestarts": "max-restarts",
      "restartInterval": "restart-interval"
    },
    "properties": [
      "message",
      "error",
      "errorInfo",
      "running"
    ],
    "commands": [
      "start",
      "post",
      "terminate"
    ]
  }
};

// src/service/ioNodeValidator.ts
var DOM_COMMON_PROPERTIES = /* @__PURE__ */ new Set([
  "textContent",
  "innerHTML",
  "innerText",
  "hidden",
  "title",
  "id",
  "slot",
  "dir",
  "lang",
  "role",
  "tabIndex",
  "className"
]);
var STRUCTURAL_DIRECTIVES2 = /* @__PURE__ */ new Set(["for", "if", "elseif", "else"]);
var EMPTYISH_SEEDS = /* @__PURE__ */ new Set(["''", '""', "``", "null", "[]", "{}"]);
function validateIoNodes(html, bindAttribute = "data-wcs", stateTagName = "wcs-state", locale, fileReader) {
  const diagnostics = [];
  const msgs = getMessages(locale);
  const occurrences = findBuiltinTagOccurrences(html);
  if (occurrences.length === 0) return diagnostics;
  let statePaths = null;
  const getPaths = () => statePaths ??= getStatePathsFromHtml(html, stateTagName, fileReader);
  for (const occ of occurrences) {
    const contract = BUILTIN_TAGS[occ.tagName];
    if (contract.properties.length === 0 && contract.commands.length === 0 && Object.keys(contract.inputs).length === 0) continue;
    const bindAttr = extractAttributeValue(occ.attrsText, bindAttribute);
    if (!bindAttr) continue;
    const valueStart = occ.attrsStart + bindAttr.valueOffsetInAttrs;
    const hasManual = hasBooleanAttribute(occ.attrsText, "manual");
    let exprOffset = 0;
    for (const expr of splitBindingExpressions(bindAttr.value)) {
      const exprStart = valueStart + exprOffset;
      exprOffset += expr.length + 1;
      const parsed = parseBindingExpression(expr);
      const property = parsed.property;
      if (!property) continue;
      const propIndex = expr.indexOf(property);
      const start = propIndex === -1 ? exprStart : exprStart + propIndex;
      const end = propIndex === -1 ? exprStart + expr.length : start + property.length;
      validateBindingAgainstContract(
        occ.tagName,
        contract,
        parsed,
        property,
        start,
        end,
        hasManual,
        getPaths,
        diagnostics,
        msgs
      );
    }
  }
  return diagnostics;
}
function validateBindingAgainstContract(tagName, contract, parsed, property, start, end, hasManual, getPaths, diagnostics, msgs) {
  const hashIndex = property.indexOf("#");
  const modifiers = hashIndex === -1 ? "" : property.slice(hashIndex + 1);
  property = hashIndex === -1 ? property : property.slice(0, hashIndex);
  if (property === "...") return;
  if (STRUCTURAL_DIRECTIVES2.has(property)) return;
  if (/^(class|style|attr)\./.test(property)) return;
  if (/^on\w/.test(property)) return;
  const inputNames = Object.keys(contract.inputs);
  if (property.startsWith("command.")) {
    const name = property.slice("command.".length);
    if (!contract.commands.includes(name)) {
      diagnostics.push({
        code: WcsDiagnosticCode.TagMemberUnknown,
        start,
        end,
        severity: "warning",
        tag: tagName,
        member: name,
        message: msgs.tagCommandUnknown(name, tagName, contract.commands.join(", ") || msgs.none()) + suggestion(name, contract.commands, msgs)
      });
    }
    return;
  }
  if (property.startsWith("eventToken.")) {
    const name = property.slice("eventToken.".length);
    if (!contract.properties.includes(name)) {
      diagnostics.push({
        code: WcsDiagnosticCode.TagMemberUnknown,
        start,
        end,
        severity: "warning",
        tag: tagName,
        member: name,
        message: msgs.tagEventTokenKeyUnknown(name, tagName, contract.properties.join(", ")) + suggestion(name, contract.properties, msgs)
      });
    }
    return;
  }
  if (!contract.properties.includes(property) && !(property in contract.inputs) && !DOM_COMMON_PROPERTIES.has(property)) {
    const members = [...contract.properties, ...inputNames];
    diagnostics.push({
      code: WcsDiagnosticCode.TagMemberUnknown,
      start,
      end,
      severity: "warning",
      tag: tagName,
      member: property,
      message: msgs.tagMemberUnknown(property, tagName) + suggestion(property, members, msgs)
    });
    return;
  }
  if (property === "trigger" && "trigger" in contract.inputs && parsed.path) {
    const cand = findDataSlot(getPaths(), parsed.path, parsed.targetState);
    if (cand?.rawInitial === "true") {
      diagnostics.push({
        code: WcsDiagnosticCode.TriggerSeededTruthy,
        start,
        end,
        severity: "warning",
        tag: tagName,
        statePath: parsed.path,
        message: msgs.triggerSeededTruthy(parsed.path)
      });
    }
  }
  if (tagName === "wcs-storage" && property === "value" && !hasManual && parsed.path && !/(?:^|,)init=(?:element|auto)\b/.test(modifiers)) {
    const cand = findDataSlot(getPaths(), parsed.path, parsed.targetState);
    if (cand?.rawInitial !== void 0 && EMPTYISH_SEEDS.has(normalizeSeed(cand.rawInitial))) {
      diagnostics.push({
        code: WcsDiagnosticCode.StorageSeedClobber,
        start,
        end,
        severity: "warning",
        tag: tagName,
        statePath: parsed.path,
        message: msgs.storageSeedClobber(parsed.path, cand.rawInitial)
      });
    }
  }
}
function findDataSlot(paths, path, stateName) {
  return paths.find((c) => c.kind === "data" && c.path === path && c.stateName === stateName);
}
function normalizeSeed(raw) {
  const compact = raw.replace(/\s+/g, "");
  return compact === "" ? raw : compact;
}
function suggestion(input, candidates, msgs) {
  let best = null;
  let bestDistance = 3;
  for (const c of candidates) {
    const d = editDistance(input.toLowerCase(), c.toLowerCase(), bestDistance);
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best !== null ? msgs.didYouMean(best) : "";
}
function editDistance(a, b, bound) {
  if (Math.abs(a.length - b.length) >= bound) return bound;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin >= bound) return bound;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return Math.min(prev[b.length], bound);
}
function findBuiltinTagOccurrences(html) {
  const out = [];
  const regex = /<(wcs-[a-z0-9-]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    if (!(tagName in BUILTIN_TAGS)) continue;
    out.push({
      tagName,
      tagStart: match.index,
      attrsText: match[2],
      attrsStart: match.index + 1 + match[1].length
    });
  }
  return out;
}
function extractAttributeValue(attrsText, attrName) {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])`, "i");
  const match = regex.exec(attrsText);
  if (!match) return null;
  const quote = match[1];
  const valueStart = match.index + match[0].length;
  const valueEnd = attrsText.indexOf(quote, valueStart);
  if (valueEnd === -1) return null;
  return { value: attrsText.slice(valueStart, valueEnd), valueOffsetInAttrs: valueStart };
}
function hasBooleanAttribute(attrsText, attrName) {
  return new RegExp(`(?:^|\\s)${attrName}(?:\\s|=|$)`, "i").test(attrsText);
}

// src/service/documentEnvValidator.ts
function validateDocumentEnv(html, locale) {
  const diagnostics = [];
  const msgs = getMessages(locale);
  const scanText = blankHtmlComments(html);
  const autos = findWcstackAutoScripts(scanText);
  const stateIndex = autos.findIndex((a) => a.pkg === "state");
  if (stateIndex !== -1) {
    for (const later of autos.slice(stateIndex + 1)) {
      if (later.pkg !== "devtools") continue;
      diagnostics.push({
        code: WcsDiagnosticCode.ScriptOrder,
        start: later.start,
        end: later.end,
        severity: "warning",
        message: msgs.devtoolsAfterState()
      });
    }
  }
  const router = autos.find((a) => a.pkg === "router");
  if (router && !/<base\b[^>]*\bhref\s*=/i.test(scanText)) {
    diagnostics.push({
      code: WcsDiagnosticCode.BaseHrefMissing,
      start: router.start,
      end: router.end,
      severity: "warning",
      message: msgs.baseHrefMissing()
    });
  }
  const refs = collectSignalsRefs(scanText);
  const dom = refs.find((r) => r.kind === "dom");
  const bare = refs.find((r) => r.kind === "bare");
  if (dom && bare) {
    const later = bare.start > dom.start ? bare : dom;
    diagnostics.push({
      code: WcsDiagnosticCode.SignalsDualEntry,
      start: later.start,
      end: later.end,
      severity: "error",
      message: msgs.signalsDualEntry()
    });
  }
  return diagnostics;
}
function findWcstackAutoScripts(html) {
  const out = [];
  const scriptRegex = /<script\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = extractSrc(match[0]);
    if (!src) continue;
    const pkgMatch = /@wcstack\/([a-z0-9-]+)\/auto\b/.exec(src.value);
    if (!pkgMatch) continue;
    out.push({
      pkg: pkgMatch[1],
      start: match.index + src.offsetInTag,
      end: match.index + src.offsetInTag + src.value.length
    });
  }
  return out;
}
function collectSignalsRefs(html) {
  const refs = [];
  const scriptRegex = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const openTag = html.slice(match.index, match.index + match[0].indexOf(">") + 1);
    const src = extractSrc(openTag);
    if (src) {
      const kind = classifySignalsSpecifier(src.value);
      if (kind) {
        refs.push({
          kind,
          start: match.index + src.offsetInTag,
          end: match.index + src.offsetInTag + src.value.length
        });
      }
      continue;
    }
    if (!/\btype\s*=\s*(["'])module\1/i.test(match[1])) continue;
    const bodyStart = match.index + match[0].indexOf(">") + 1;
    const body = blankJsComments(match[2]);
    const importRegex = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"']*@wcstack\/signals[^"']*)\1/g;
    let im;
    while ((im = importRegex.exec(body)) !== null) {
      const kind = classifySignalsSpecifier(im[2]);
      if (!kind) continue;
      const specStart = bodyStart + im.index + im[0].indexOf(im[1]) + 1;
      refs.push({ kind, start: specStart, end: specStart + im[2].length });
    }
  }
  return refs;
}
function classifySignalsSpecifier(spec) {
  if (!spec.includes("@wcstack/signals")) return null;
  return /@wcstack\/signals\/dom\b/.test(spec) ? "dom" : "bare";
}
function extractSrc(openTag) {
  const srcMatch = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(openTag);
  if (!srcMatch) return null;
  return {
    value: srcMatch[2],
    offsetInTag: srcMatch.index + srcMatch[0].indexOf(srcMatch[1]) + 1
  };
}
function blankHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
}
function blankJsComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length)).replace(/(^|[^:])\/\/[^\n]*/g, (m, pre) => pre + " ".repeat(m.length - pre.length));
}

// src/service/watchDeclarationValidator.ts
var STATE_NAME_SEPARATOR = "@";
function validateWatchDeclarations(html, stateTagName = "wcs-state", locale) {
  const msgs = getMessages(locale);
  const out = [];
  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    const nonObject = findNonObjectWatch(block.content);
    if (nonObject !== null) {
      out.push({
        code: WcsDiagnosticCode.WatchDeclarationInvalid,
        start: block.contentStart + nonObject.start,
        end: block.contentStart + nonObject.end,
        message: msgs.watchNotObject(),
        severity: "error"
      });
    }
    const entries = analyzeWatchEntries(block.content);
    if (entries.length === 0) continue;
    const paths = analyzeStatePaths(block.content, block.stateName);
    const pathSet = new Set(paths.map((p) => p.path));
    for (const entry of entries) {
      const diagnostic = validateEntry(entry, pathSet, msgs);
      if (diagnostic === null) continue;
      out.push({
        code: diagnostic.code,
        start: block.contentStart + entry.start,
        end: block.contentStart + entry.end,
        message: diagnostic.message,
        severity: diagnostic.severity
      });
    }
  }
  return out;
}
function validateEntry(entry, pathSet, msgs) {
  const { key } = entry;
  const invalid = (message) => ({ code: WcsDiagnosticCode.WatchDeclarationInvalid, message, severity: "error" });
  if (key.includes(STATE_NAME_SEPARATOR)) {
    return invalid(msgs.watchKeyCrossState(key));
  }
  if (key.startsWith("$")) {
    return invalid(msgs.watchKeyReserved(key));
  }
  if (key.split(".").some((segment) => segment.length === 0)) {
    return invalid(msgs.watchKeyEmptySegment(key));
  }
  if (entry.definitelyNotFunction) {
    return invalid(msgs.watchHandlerNotFunction(key));
  }
  if (pathSet.size > 0 && !pathSet.has(key)) {
    return {
      code: WcsDiagnosticCode.WatchPathMissing,
      message: msgs.watchPathMissing(key),
      severity: "warning"
    };
  }
  return null;
}

// src/core/validateDocument.ts
function validateDocument(text, options = {}) {
  const bindAttribute = options.bindAttribute ?? "data-wcs";
  const stateTagName = options.stateTagName ?? "wcs-state";
  const locale = options.locale;
  const fileReader = options.fileReader;
  const out = [];
  out.push(...validateBindings(text, bindAttribute, stateTagName, locale, fileReader));
  out.push(...validateTemplateSyntax(text, stateTagName, bindAttribute, locale, fileReader));
  out.push(...validateIoNodes(text, bindAttribute, stateTagName, locale, fileReader));
  out.push(...validateDocumentEnv(text, locale));
  out.push(...validateArrayMutations(text, stateTagName, locale));
  out.push(...validateWatchDeclarations(text, stateTagName, locale));
  for (const d of validateStateTypes(text, stateTagName, locale)) {
    out.push({ code: WcsDiagnosticCode.TypeAnnotation, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  for (const d of validateNestedAssigns(text, stateTagName, locale)) {
    out.push({ code: WcsDiagnosticCode.NestedAssign, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  return sortDiagnostics(out);
}

// src/core/sidecar/schemaSubset.ts
var ALLOWED_SCHEMA_KEYWORDS = /* @__PURE__ */ new Set([
  "type",
  "properties",
  "required",
  "items",
  "enum",
  "const",
  "anyOf",
  "$defs",
  "$ref"
]);
var DiagnosticContext = class {
  constructor(spans) {
    this.spans = spans;
  }
  diagnostics = [];
  add(code, pointer2, message, severity, extra = {}, useKeySpan = false) {
    const span = this.spans.get(pointer2);
    const start = span === void 0 ? 0 : useKeySpan ? span.keyStart ?? span.start : span.start;
    const end = span === void 0 ? 0 : useKeySpan ? span.keyEnd ?? span.end : span.end;
    this.diagnostics.push({ code, start, end, message, severity, ...extra });
  }
};
function isSchemaObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isSchemaMap(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validateSchemaSubset(schema, pointerBase, ctx, rootDefs) {
  walkKeywords(schema, pointerBase, ctx, rootDefs);
  const safe = /* @__PURE__ */ new Set();
  detectCycles(schema, pointerBase, ctx, rootDefs, /* @__PURE__ */ new Set(), safe);
  for (const [name, def] of Object.entries(rootDefs)) {
    detectCycles(def, `${pointerBase}/$defs/${escape(name)}`, ctx, rootDefs, /* @__PURE__ */ new Set(), safe);
  }
}
function walkKeywords(node, ptr, ctx, rootDefs) {
  if (!isSchemaObject(node)) return;
  for (const keyword of Object.keys(node)) {
    if (!ALLOWED_SCHEMA_KEYWORDS.has(keyword)) {
      ctx.add(
        WcsDiagnosticCode.ManifestUnknownKeyword,
        `${ptr}/${escape(keyword)}`,
        `Unsupported schema keyword "${keyword}". Allowed: ${[...ALLOWED_SCHEMA_KEYWORDS].join(", ")}.`,
        "warning",
        {},
        true
      );
    }
  }
  if (typeof node.$ref === "string") {
    if (!node.$ref.startsWith("#/")) {
      ctx.add(
        WcsDiagnosticCode.ManifestExternalRef,
        `${ptr}/$ref`,
        `External $ref "${node.$ref}" is forbidden; only local "#/$defs/..." references are allowed.`,
        "error"
      );
    } else if (resolveLocalRef(node.$ref, rootDefs) === void 0) {
      ctx.add(
        WcsDiagnosticCode.ManifestRefUnresolved,
        `${ptr}/$ref`,
        `Unresolved local $ref "${node.$ref}".`,
        "error"
      );
    }
  }
  if (isSchemaMap(node.properties)) {
    for (const [name, child] of Object.entries(node.properties)) {
      walkKeywords(child, `${ptr}/properties/${escape(name)}`, ctx, rootDefs);
    }
  }
  if (node.items !== void 0 && isSchemaObject(node.items)) {
    walkKeywords(node.items, `${ptr}/items`, ctx, rootDefs);
  }
  if (Array.isArray(node.anyOf)) {
    node.anyOf.forEach((child, i) => walkKeywords(child, `${ptr}/anyOf/${i}`, ctx, rootDefs));
  }
  if (isSchemaMap(node.$defs)) {
    for (const [name, child] of Object.entries(node.$defs)) {
      walkKeywords(child, `${ptr}/$defs/${escape(name)}`, ctx, rootDefs);
    }
  }
}
function detectCycles(node, ptr, ctx, rootDefs, refStack, safe) {
  if (!isSchemaObject(node)) return;
  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    if (!ref.startsWith("#/")) return;
    if (refStack.has(ref)) {
      ctx.add(WcsDiagnosticCode.ManifestRefCycle, `${ptr}/$ref`, `Cyclic $ref detected at "${ref}".`, "error");
      return;
    }
    if (safe.has(ref)) return;
    const target = resolveLocalRef(ref, rootDefs);
    if (target === void 0) return;
    refStack.add(ref);
    detectCycles(target, ptr, ctx, rootDefs, refStack, safe);
    refStack.delete(ref);
    safe.add(ref);
    return;
  }
  if (isSchemaMap(node.properties)) {
    for (const child of Object.values(node.properties)) detectCycles(child, ptr, ctx, rootDefs, refStack, safe);
  }
  if (node.items !== void 0 && isSchemaObject(node.items)) {
    detectCycles(node.items, ptr, ctx, rootDefs, refStack, safe);
  }
  if (Array.isArray(node.anyOf)) {
    for (const child of node.anyOf) detectCycles(child, ptr, ctx, rootDefs, refStack, safe);
  }
}
function resolveLocalRef(ref, rootDefs) {
  const match = /^#\/\$defs\/(.+)$/.exec(ref);
  if (match === null) return void 0;
  const name = match[1].replace(/~1/g, "/").replace(/~0/g, "~");
  return rootDefs[name];
}
function escape(key) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

// src/core/sidecar/jsonSource.ts
var JsonReader = class {
  constructor(text) {
    this.text = text;
  }
  pos = 0;
  spans = /* @__PURE__ */ new Map();
  parse() {
    this.skipWs();
    const value = this.parseValue("", void 0);
    this.skipWs();
    if (this.pos < this.text.length) {
      throw this.fail(`Unexpected trailing content`);
    }
    return { value };
  }
  fail(message) {
    const err = new Error(message);
    err.offset = Math.min(this.pos, this.text.length);
    return err;
  }
  skipWs() {
    while (this.pos < this.text.length) {
      const c = this.text.charCodeAt(this.pos);
      if (c === 32 || c === 9 || c === 10 || c === 13) this.pos++;
      else break;
    }
  }
  parseValue(pointer2, keySpan) {
    this.skipWs();
    const start = this.pos;
    const c = this.text[this.pos];
    let value;
    if (c === "{") value = this.parseObject(pointer2);
    else if (c === "[") value = this.parseArray(pointer2);
    else if (c === '"') value = this.parseString();
    else if (c === "t" || c === "f") value = this.parseKeyword();
    else if (c === "n") value = this.parseNull();
    else if (c === "-" || c >= "0" && c <= "9") value = this.parseNumber();
    else throw this.fail(`Unexpected character`);
    const end = this.pos;
    this.spans.set(pointer2, keySpan === void 0 ? { start, end } : { start, end, ...keySpan });
    return value;
  }
  parseObject(pointer2) {
    this.pos++;
    const obj = {};
    this.skipWs();
    if (this.text[this.pos] === "}") {
      this.pos++;
      return obj;
    }
    for (; ; ) {
      this.skipWs();
      if (this.text[this.pos] !== '"') throw this.fail(`Expected object key`);
      const keyStart = this.pos;
      const key = this.parseString();
      const keyEnd = this.pos;
      this.skipWs();
      if (this.text[this.pos] !== ":") throw this.fail(`Expected ':'`);
      this.pos++;
      const childPointer = `${pointer2}/${escapePointer(key)}`;
      obj[key] = this.parseValue(childPointer, { keyStart, keyEnd });
      this.skipWs();
      const sep = this.text[this.pos];
      if (sep === ",") {
        this.pos++;
        continue;
      }
      if (sep === "}") {
        this.pos++;
        return obj;
      }
      throw this.fail(`Expected ',' or '}'`);
    }
  }
  parseArray(pointer2) {
    this.pos++;
    const arr = [];
    this.skipWs();
    if (this.text[this.pos] === "]") {
      this.pos++;
      return arr;
    }
    let index = 0;
    for (; ; ) {
      const childPointer = `${pointer2}/${index}`;
      arr.push(this.parseValue(childPointer, void 0));
      index++;
      this.skipWs();
      const sep = this.text[this.pos];
      if (sep === ",") {
        this.pos++;
        continue;
      }
      if (sep === "]") {
        this.pos++;
        return arr;
      }
      throw this.fail(`Expected ',' or ']'`);
    }
  }
  parseString() {
    this.pos++;
    let result = "";
    for (; ; ) {
      if (this.pos >= this.text.length) throw this.fail(`Unterminated string`);
      const ch = this.text[this.pos++];
      if (ch === '"') return result;
      if (ch === "\\") {
        const esc = this.text[this.pos++];
        if (esc === '"') result += '"';
        else if (esc === "\\") result += "\\";
        else if (esc === "/") result += "/";
        else if (esc === "b") result += "\b";
        else if (esc === "f") result += "\f";
        else if (esc === "n") result += "\n";
        else if (esc === "r") result += "\r";
        else if (esc === "t") result += "	";
        else if (esc === "u") {
          const hex = this.text.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.fail(`Invalid unicode escape`);
          result += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
        } else throw this.fail(`Invalid escape`);
      } else {
        result += ch;
      }
    }
  }
  parseKeyword() {
    if (this.text.startsWith("true", this.pos)) {
      this.pos += 4;
      return true;
    }
    if (this.text.startsWith("false", this.pos)) {
      this.pos += 5;
      return false;
    }
    throw this.fail(`Invalid literal`);
  }
  parseNull() {
    if (this.text.startsWith("null", this.pos)) {
      this.pos += 4;
      return null;
    }
    throw this.fail(`Invalid literal`);
  }
  parseNumber() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.text.slice(this.pos));
    if (match === null) throw this.fail(`Invalid number`);
    this.pos += match[0].length;
    return Number(match[0]);
  }
};
function escapePointer(key) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}
function pointer(...segments) {
  return segments.map((s) => `/${escapePointer(String(s))}`).join("");
}
function parseJsonWithSpans(text) {
  const reader = new JsonReader(text);
  try {
    const { value } = reader.parse();
    return { value, spans: reader.spans, error: null };
  } catch (e) {
    const offset = e.offset ?? 0;
    return { value: void 0, spans: reader.spans, error: { offset, message: e.message } };
  }
}

// src/core/sidecar/types.ts
var SUPPORTED_SCHEMA_VERSION = 1;
var SUPPORTED_NAMESPACE_VERSION = 1;

// src/core/sidecar/loader.ts
var NAMESPACE_KEYS = ["wcstack.types", "wcstack.async", "wcstack.platformCapabilities", "wcstack.application"];
function loadManifest(artifact) {
  const parsed = parseJsonWithSpans(artifact.text);
  const ctx = new DiagnosticContext(parsed.spans);
  if (parsed.error !== null) {
    ctx.diagnostics.push({
      code: WcsDiagnosticCode.ManifestBroken,
      start: parsed.error.offset,
      end: Math.min(parsed.error.offset + 1, artifact.text.length),
      message: `Broken manifest JSON: ${parsed.error.message}.`,
      severity: "error"
    });
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  const root = parsed.value;
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    ctx.add(WcsDiagnosticCode.ManifestBroken, "", `Manifest root must be a JSON object.`, "error");
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  const obj = root;
  if (obj.schemaVersion === void 0) {
    ctx.add(WcsDiagnosticCode.ManifestSchemaVersion, "", `Manifest is missing an integer "schemaVersion".`, "error");
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  if (typeof obj.schemaVersion !== "number" || !Number.isInteger(obj.schemaVersion)) {
    ctx.add(
      WcsDiagnosticCode.ManifestSchemaVersion,
      pointer("schemaVersion"),
      `Manifest "schemaVersion" must be an integer.`,
      "error"
    );
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  if (obj.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    ctx.add(
      WcsDiagnosticCode.ManifestSchemaVersion,
      pointer("schemaVersion"),
      `Unsupported schemaVersion ${obj.schemaVersion}; this reader supports ${SUPPORTED_SCHEMA_VERSION}.`,
      "error"
    );
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  if (obj.kind !== "package" && obj.kind !== "application") {
    ctx.add(
      WcsDiagnosticCode.ManifestKindInvalid,
      obj.kind === void 0 ? "" : pointer("kind"),
      `Manifest "kind" must be "package" or "application".`,
      "error"
    );
    return { artifact, manifest: null, ctx, spans: parsed.spans };
  }
  const extensions = obj.manifestExtensions;
  if (extensions !== null && typeof extensions === "object") {
    for (const ns of NAMESPACE_KEYS) {
      const nsObj = extensions[ns];
      if (nsObj !== null && typeof nsObj === "object") {
        const version = nsObj.version;
        if (typeof version === "number" && version !== SUPPORTED_NAMESPACE_VERSION) {
          ctx.add(
            WcsDiagnosticCode.ManifestNamespaceVersion,
            pointer("manifestExtensions", ns, "version"),
            `Namespace "${ns}" version ${version} is unsupported (expected ${SUPPORTED_NAMESPACE_VERSION}).`,
            "warning"
          );
        }
      }
    }
  }
  return { artifact, manifest: obj, ctx, spans: parsed.spans };
}
function resolvePackageContracts(loaded) {
  const perSource = /* @__PURE__ */ new Map();
  const ctxBySource = /* @__PURE__ */ new Map();
  const ctxFor = (lm) => {
    let ctx = ctxBySource.get(lm.artifact.source);
    if (ctx === void 0) {
      ctx = new DiagnosticContext(lm.spans);
      ctxBySource.set(lm.artifact.source, ctx);
      perSource.set(lm.artifact.source, ctx.diagnostics);
    }
    return ctx;
  };
  const winners = /* @__PURE__ */ new Map();
  const collided = /* @__PURE__ */ new Set();
  const firstSource = /* @__PURE__ */ new Map();
  const filterOwner = /* @__PURE__ */ new Map();
  for (const lm of loaded) {
    if (lm.manifest === null) continue;
    const types = lm.manifest.manifestExtensions?.["wcstack.types"];
    if (lm.manifest.kind === "package" && types !== void 0) {
      for (const [tag, component] of Object.entries(types.components ?? {})) {
        const ptr = pointer("manifestExtensions", "wcstack.types", "components", tag);
        if (!winners.has(tag) && !collided.has(tag)) {
          winners.set(tag, { tag, component, source: lm.artifact.source });
          firstSource.set(tag, lm.artifact.source);
          continue;
        }
        if (component.override === true) {
          ctxFor(lm).add(
            WcsDiagnosticCode.ManifestOverride,
            ptr,
            `Component "${tag}" explicitly overrides a prior package contract.`,
            "info",
            { tag },
            true
          );
          continue;
        }
        const priorSource = firstSource.get(tag) ?? "an earlier artifact";
        collided.add(tag);
        winners.delete(tag);
        ctxFor(lm).add(
          WcsDiagnosticCode.ManifestTagCollision,
          ptr,
          `Component tag "${tag}" is defined by multiple package artifacts (also in "${priorSource}"). Set "override": true to intentionally shadow.`,
          "error",
          { tag },
          true
        );
      }
    }
    const application = lm.manifest.manifestExtensions?.["wcstack.application"];
    if (lm.manifest.kind === "application" && application?.filters !== void 0) {
      for (const name of Object.keys(application.filters)) {
        const priorSource = filterOwner.get(name);
        if (priorSource === void 0) {
          filterOwner.set(name, lm.artifact.source);
          continue;
        }
        ctxFor(lm).add(
          WcsDiagnosticCode.ManifestFilterCollision,
          pointer("manifestExtensions", "wcstack.application", "filters", name),
          `Filter "${name}" is defined by multiple application artifacts (also in "${priorSource}").`,
          "error",
          { member: name },
          true
        );
      }
    }
  }
  const diagnosticsBySource = /* @__PURE__ */ new Map();
  for (const [source, diags] of perSource) {
    const kept = diags.filter((d) => !(d.code === WcsDiagnosticCode.ManifestOverride && d.tag !== void 0 && collided.has(d.tag)));
    if (kept.length > 0) diagnosticsBySource.set(source, kept);
  }
  return { tags: winners, diagnosticsBySource };
}

// src/core/sidecar/drift.ts
function checkDrift(tag, component, live, ctx) {
  const liveProps = new Map(live.properties.map((p) => [p.name, p.event]));
  const liveInputs = new Set((live.inputs ?? []).map((i) => i.name));
  const liveCommands = new Set((live.commands ?? []).map((c) => c.name));
  for (const [name, observable] of Object.entries(component.observables ?? {})) {
    const memberPtr = pointer("manifestExtensions", "wcstack.types", "components", tag, "observables", name);
    if (!liveProps.has(name)) {
      ctx.add(
        WcsDiagnosticCode.DriftMissingMember,
        memberPtr,
        `Sidecar declares observable "${name}" on <${tag}>, but the live wcBindable declaration has no such property.`,
        "error",
        { tag, member: name },
        true
      );
      continue;
    }
    const liveEvent = liveProps.get(name);
    if (observable.event !== liveEvent) {
      ctx.add(
        WcsDiagnosticCode.DriftEventMismatch,
        pointer("manifestExtensions", "wcstack.types", "components", tag, "observables", name, "event"),
        `Sidecar observable "${name}" on <${tag}> declares event "${observable.event}", but the live declaration uses "${liveEvent}".`,
        "error",
        { tag, member: name }
      );
    }
  }
  for (const name of Object.keys(component.inputs ?? {})) {
    if (!liveInputs.has(name)) {
      ctx.add(
        WcsDiagnosticCode.DriftMissingMember,
        pointer("manifestExtensions", "wcstack.types", "components", tag, "inputs", name),
        `Sidecar declares input "${name}" on <${tag}>, but the live wcBindable declaration has no such input.`,
        "error",
        { tag, member: name },
        true
      );
    }
  }
  for (const name of Object.keys(component.commands ?? {})) {
    if (!liveCommands.has(name)) {
      ctx.add(
        WcsDiagnosticCode.DriftMissingMember,
        pointer("manifestExtensions", "wcstack.types", "components", tag, "commands", name),
        `Sidecar declares command "${name}" on <${tag}>, but the live wcBindable declaration has no such command.`,
        "error",
        { tag, member: name },
        true
      );
    }
  }
}

// src/core/sidecar/validate.ts
function validateLoadedSchemas(loaded) {
  if (loaded.manifest === null) return;
  const types = loaded.manifest.manifestExtensions?.["wcstack.types"];
  if (types === void 0) return;
  for (const [tag, component] of Object.entries(types.components ?? {})) {
    validateComponentSchemas(tag, component, loaded.ctx);
  }
}
function validateComponentSchemas(tag, component, ctx) {
  const base = pointer("manifestExtensions", "wcstack.types", "components", tag);
  const walkSchema = (schema, ptr) => {
    if (schema === void 0) return;
    validateSchemaSubset(schema, ptr, ctx, schema.$defs ?? {});
  };
  for (const [name, observable] of Object.entries(component.observables ?? {})) {
    walkSchema(observable.schema, `${base}/observables/${escapePtr(name)}/schema`);
  }
  for (const [name, input] of Object.entries(component.inputs ?? {})) {
    walkSchema(input.schema, `${base}/inputs/${escapePtr(name)}/schema`);
  }
  for (const [name, command] of Object.entries(component.commands ?? {})) {
    walkSchema(command.args, `${base}/commands/${escapePtr(name)}/args`);
    walkSchema(command.result, `${base}/commands/${escapePtr(name)}/result`);
  }
}
function validateManifestSet(input) {
  const loadedList = input.artifacts.map(loadManifest);
  const byArtifact = /* @__PURE__ */ new Map();
  for (const loaded of loadedList) {
    validateLoadedSchemas(loaded);
    if (input.liveDeclarations !== void 0 && loaded.manifest?.kind === "package") {
      const types = loaded.manifest.manifestExtensions?.["wcstack.types"];
      for (const [tag, component] of Object.entries(types?.components ?? {})) {
        const live = input.liveDeclarations.get(tag);
        if (live !== void 0) {
          checkDrift(tag, component, live, loaded.ctx);
        }
      }
    }
    const existing = byArtifact.get(loaded.artifact.source) ?? [];
    byArtifact.set(loaded.artifact.source, [...existing, ...loaded.ctx.diagnostics]);
  }
  const resolved = resolvePackageContracts(loadedList);
  for (const [source, diags] of resolved.diagnosticsBySource) {
    const existing = byArtifact.get(source) ?? [];
    byArtifact.set(source, [...existing, ...diags]);
  }
  const all = [];
  for (const diags of byArtifact.values()) all.push(...diags);
  const resolvedTags = /* @__PURE__ */ new Map();
  for (const [tag, contract] of resolved.tags) resolvedTags.set(tag, contract.source);
  const sortedByArtifact = /* @__PURE__ */ new Map();
  for (const [source, diags] of byArtifact) sortedByArtifact.set(source, sortDiagnostics(diags));
  return {
    diagnostics: sortDiagnostics(all),
    byArtifact: sortedByArtifact,
    resolvedTags
  };
}
function escapePtr(key) {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

// src/core/cli/runValidation.ts
var severityLabel = { error: "error", warning: "warning", info: "info" };
function runValidation(inputs, options = {}) {
  const diagnosticsBySource = /* @__PURE__ */ new Map();
  for (const input of inputs) {
    if (input.kind === "html") {
      const docOptions = input.fileReader !== void 0 ? { ...options, fileReader: input.fileReader } : options;
      diagnosticsBySource.set(input.source, validateDocument(input.text, docOptions));
    }
  }
  const manifestInputs = inputs.filter((i) => i.kind === "manifest");
  if (manifestInputs.length > 0) {
    const result = validateManifestSet({
      artifacts: manifestInputs.map((m) => ({ text: m.text, source: m.source })),
      liveDeclarations: options.liveDeclarations
    });
    for (const input of manifestInputs) {
      diagnosticsBySource.set(input.source, result.byArtifact.get(input.source) ?? []);
    }
  }
  const textBySource = new Map(inputs.map((i) => [i.source, i.text]));
  const lines = [];
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const source of [...diagnosticsBySource.keys()].sort()) {
    const diags = diagnosticsBySource.get(source);
    const mapper = createPositionMapper(textBySource.get(source) ?? "");
    for (const d of diags) {
      if (d.severity === "error") errorCount++;
      else if (d.severity === "warning") warningCount++;
      else infoCount++;
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
    diagnosticsBySource
  };
}

// src/cli.ts
function classify(path) {
  return path.endsWith(".manifest.json") ? "manifest" : "html";
}
function createFileReader(htmlPath, read = (p) => (0, import_node_fs.readFileSync)(p, "utf8")) {
  const base = (0, import_node_path.dirname)(htmlPath);
  const cache = /* @__PURE__ */ new Map();
  return (relativePath) => {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(relativePath) || relativePath.startsWith("/")) {
      return void 0;
    }
    if (cache.has(relativePath)) {
      return cache.get(relativePath);
    }
    let content;
    try {
      content = read((0, import_node_path.resolve)(base, relativePath));
      if (content.charCodeAt(0) === 65279) {
        content = content.slice(1);
      }
    } catch {
      content = void 0;
    }
    cache.set(relativePath, content);
    return content;
  };
}
function parseArgs(argv) {
  const options = {};
  const files = [];
  for (const arg of argv) {
    if (arg.startsWith("--attr=")) options.bindAttribute = arg.slice("--attr=".length);
    else if (arg.startsWith("--state-tag=")) options.stateTagName = arg.slice("--state-tag=".length);
    else if (arg.startsWith("--lang=")) options.locale = arg.slice("--lang=".length);
    else if (arg === "--errors-only" || arg === "--quiet") options.errorsOnly = true;
    else if (!arg.startsWith("-")) files.push(arg);
  }
  return { options, files };
}
function resolveCliLocale(explicit, env = process.env) {
  if (explicit) return explicit;
  const fromEnv = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  if (fromEnv) return fromEnv;
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}
function main(argv) {
  const { options, files } = parseArgs(argv);
  const locale = resolveCliLocale(options.locale);
  if (files.length === 0) {
    process.stderr.write("usage: wcs-validate [--attr=data-wcs] [--state-tag=wcs-state] [--lang=ja|en] <file> [<file> ...]\n");
    return 2;
  }
  const inputs = [];
  for (const path of files) {
    let text;
    try {
      text = (0, import_node_fs.readFileSync)(path, "utf8");
    } catch (e) {
      process.stderr.write(`cannot read ${path}: ${e.message}
`);
      return 2;
    }
    const kind = classify(path);
    inputs.push({ source: path, text, kind, fileReader: kind === "html" ? createFileReader(path) : void 0 });
  }
  const result = runValidation(inputs, { ...options, locale });
  for (const line of result.lines) {
    process.stdout.write(line + "\n");
  }
  process.stdout.write(
    `
${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info
`
  );
  return result.exitCode;
}
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createFileReader,
  main,
  parseArgs,
  resolveCliLocale
});
//# sourceMappingURL=cli.cjs.map
