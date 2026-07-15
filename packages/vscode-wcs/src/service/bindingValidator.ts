/**
 * bindingValidator.ts
 *
 * HTML 内の data-wcs バインディング式を検証し、診断情報を生成する。
 *
 * 検証項目:
 * - パスが状態定義に存在するか
 * - フィルタ名が組み込みフィルタに存在するか
 */

import { BUILTIN_FILTERS, type FilterInfo } from './completionData.js';
import type { PathCandidate } from './stateAnalyzer.js';
import { getStatePathsFromHtml } from './statePathResolver.js';
import { isInsideForTemplate, getInnermostForPath } from './forContext.js';
import { WcsDiagnosticCode, type WcsDiagnosticCodeValue } from '../core/diagnostics.js';

/** フィルタ名 → FilterInfo のマップ */
const filterMap = new Map<string, FilterInfo>(BUILTIN_FILTERS.map(f => [f.name, f]));

/** 診断情報 */
export interface BindingDiagnostic {
  /** 安定した診断 code（IDE / CI 一致の要）。 */
  code: WcsDiagnosticCodeValue;
  /** HTML 内のオフセット（開始） */
  start: number;
  /** HTML 内のオフセット（終了） */
  end: number;
  /** メッセージ */
  message: string;
  /** 重大度: 'error' | 'warning' | 'info' */
  severity: 'error' | 'warning' | 'info';
}

/**
 * HTML 内の全バインド属性を検証して診断情報を返す。
 *
 * @param html - HTML 全文
 * @param attrName - バインド属性名（例: "data-wcs"）
 */
export function validateBindings(html: string, attrName: string, stateTagName: string = 'wcs-state'): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];

  // 状態パスを収集（state 名ごとに分類）
  const statePaths = getStatePathsFromHtml(html, stateTagName);
  const pathsByState = new Map<string, PathCandidate[]>();
  for (const p of statePaths) {
    const list = pathsByState.get(p.stateName) ?? [];
    list.push(p);
    pathsByState.set(p.stateName, list);
  }

  // バインド属性を全て検出
  const attrs = findAllBindAttributes(html, attrName);

  const filterNameSet = new Set(BUILTIN_FILTERS.map(f => f.name));

  for (const attr of attrs) {
    const bindings = splitBindingExpressions(attr.value);
    let pos = 0;

    for (const binding of bindings) {
      const bindingStart = attr.valueStart + pos;

      // パスとフィルタを抽出
      const parsed = parseBindingExpression(binding);

      // パス検証（targetState でスコープ）
      const scopedPaths = pathsByState.get(parsed.targetState) ?? [];
      const scopedPathSet = new Set(scopedPaths.map(p => p.path));
      const propNoMod = parsed.property.replace(/#.*$/, '').trim();

      // スプレッド `...: target` — フィルタ禁止・ターゲット必須（parseBindTextsForElement.ts と対応）。
      // ターゲット自体は通常の state パスなので、存在検証は共通ロジックに流す。
      if (propNoMod === '...') {
        for (const filter of parsed.filters) {
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: bindingStart + filter.offset,
            end: bindingStart + filter.offset + filter.name.length,
            message: `スプレッドのターゲットにフィルタは使用できません`,
            severity: 'error',
          });
        }
        if (!parsed.path || parsed.path.trim() === '') {
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: bindingStart,
            end: bindingStart + binding.length,
            message: `スプレッドにはターゲットパスが必要です`,
            severity: 'error',
          });
        }
      }

      // event-token バインディング `eventToken.<prop>: <tokenName>` — 右辺は state パスではなく
      // $eventTokens 宣言名（eventTokenHandler.ts）。トークン名の検証のみ行い、以降はスキップ。
      if (propNoMod.startsWith('eventToken.')) {
        const tokenNames = new Set(
          scopedPaths.filter(p => p.kind === 'eventToken').map(p => p.path),
        );
        const tokenName = parsed.path?.trim() ?? '';
        if (tokenName && tokenNames.size > 0 && !tokenNames.has(tokenName)) {
          const pathOffset = binding.indexOf(parsed.path!);
          const pathStart = bindingStart + pathOffset;
          diagnostics.push({
            code: WcsDiagnosticCode.TokenUndeclared,
            start: pathStart,
            end: pathStart + tokenName.length,
            message: `イベントトークン "${tokenName}" は $eventTokens に宣言されていません`,
            severity: 'warning',
          });
        }
        pos += binding.length + 1;
        continue;
      }

      // command-token バインディング `command.<method>: $command.<name>`（applyChangeToCommand.ts）。
      // 右辺の検証のみ行い、以降はスキップ。
      const commandNames = new Set(
        scopedPaths.filter(p => p.kind === 'command').map(p => p.path),
      );
      if (propNoMod.startsWith('command.')) {
        const tokenPath = parsed.path?.trim() ?? '';
        if (tokenPath) {
          const pathOffset = binding.indexOf(parsed.path!);
          const pathStart = bindingStart + pathOffset;
          if (!tokenPath.startsWith('$command.')) {
            diagnostics.push({
              code: WcsDiagnosticCode.TokenMisconfigured,
              start: pathStart,
              end: pathStart + tokenPath.length,
              message: `command バインディングの右辺には $command.<name>（$commandTokens で宣言）を指定してください`,
              severity: 'warning',
            });
          } else if (commandNames.size > 0 && !commandNames.has(tokenPath)) {
            diagnostics.push({
              code: WcsDiagnosticCode.TokenUndeclared,
              start: pathStart,
              end: pathStart + tokenPath.length,
              message: `コマンドトークン "${tokenPath}" は $commandTokens に宣言されていません`,
              severity: 'warning',
            });
          }
        }
        pos += binding.length + 1;
        continue;
      }

      if (parsed.path && scopedPaths.length > 0) {
        const pathTrimmed = parsed.path.trim();
        if (pathTrimmed && !isLiteral(pathTrimmed)) {
          // 省略パスの場合は展開してから検証
          let checkPath = pathTrimmed;
          if (pathTrimmed.startsWith('.')) {
            const forPath = getInnermostForPath(html, attr.valueStart, attrName);
            if (forPath && !forPath.startsWith('.')) {
              checkPath = `${forPath}.*.${pathTrimmed.slice(1)}`;
            } else {
              checkPath = ''; // 展開できない場合はスキップ
            }
          }
          if (checkPath) {
            const message = validatePathExistence(checkPath, pathTrimmed, scopedPaths, scopedPathSet, commandNames);
            if (message) {
              const pathOffset = binding.indexOf(parsed.path);
              const pathStart = bindingStart + pathOffset;
              diagnostics.push({
                code: WcsDiagnosticCode.BindingPathMissing,
                start: pathStart,
                end: pathStart + pathTrimmed.length,
                message: `${message}${pathTrimmed.startsWith('.') ? `（展開: ${checkPath}）` : ''}`,
                severity: 'warning',
              });
            }
          }
        }
      }

      // UI パス制約チェック
      if (parsed.path) {
        const pathTrimmed = parsed.path.trim();
        const prop = parsed.property.replace(/#.*$/, '');
        const insideFor = isInsideForTemplate(html, attr.valueStart, attrName);

        if (pathTrimmed && !prop.startsWith('on')) {
          // for 外でパターンパス（* を含む）を使用
          if (!insideFor && pathTrimmed.includes('*')) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: `パターンパス "${pathTrimmed}" は <template for> の外側では使用できません`,
              severity: 'warning',
            });
          }

          // for 外で省略パス（. から始まる）を使用
          if (!insideFor && pathTrimmed.startsWith('.')) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: `省略パス "${pathTrimmed}" は <template for> の外側では使用できません`,
              severity: 'warning',
            });
          }

          // for 外でループインデックス（$1〜）を使用
          if (!insideFor && /^\$\d+$/.test(pathTrimmed)) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: `ループインデックス "${pathTrimmed}" は <template for> の外側では使用できません`,
              severity: 'warning',
            });
          }

          // UI で解決済みパス（数値セグメントを含む）を使用
          if (/\.\d+\.|\.\d+$/.test(pathTrimmed)) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: `解決済みパス "${pathTrimmed}" は UI バインディングでは使用できません。パターンパスを使用してください`,
              severity: 'warning',
            });
          }
        }
      }

      // フィルタ検証
      if (propNoMod === '...') {
        // スプレッドのフィルタ違反は上で error として報告済み
      } else if (parsed.property.startsWith('on') && parsed.filters.length > 0) {
        // イベントハンドラにフィルタは使用不可
        for (const filter of parsed.filters) {
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: bindingStart + filter.offset,
            end: bindingStart + filter.offset + filter.name.length,
            message: `イベントハンドラ "${parsed.property}" にフィルタは使用できません`,
            severity: 'warning',
          });
        }
      } else {
        for (const filter of parsed.filters) {
          diagnostics.push(...validateFilterUsage(filter, bindingStart));
        }

        // フィルタ間の入力型チェック
        if (parsed.path && statePaths.length > 0) {
          const pathTrimmed = parsed.path.trim();
          if (pathTrimmed && !pathTrimmed.startsWith('.') && !isLiteral(pathTrimmed)) {
            const chainDiags = validateFilterChainTypes(
              pathTrimmed, parsed.filters, scopedPaths, bindingStart,
            );
            diagnostics.push(...chainDiags);
          }
        }
      }

      // prop 側 input フィルタの検証（two-way の書き戻し方向。
      // ランタイムの input / output フィルタ集合は同一 — filters/builtinFilters.ts）
      for (const filter of parsed.inputFilters) {
        diagnostics.push(...validateFilterUsage(filter, bindingStart));
      }

      // プロパティに応じた型チェック
      if (parsed.path && scopedPaths.length > 0) {
        const pathTrimmed = parsed.path.trim();
        if (pathTrimmed && !pathTrimmed.startsWith('.') && !isLiteral(pathTrimmed)) {
          const resultType = resolveResultType(pathTrimmed, parsed.filters, scopedPaths);
          if (resultType !== null) {
            const typeReq = getExpectedType(parsed.property);
            if (typeReq && resultType !== typeReq.expected) {
              const pathOffset = binding.indexOf(parsed.path);
              const pathStart = bindingStart + pathOffset;
              diagnostics.push({
                code: WcsDiagnosticCode.BindingTypeExpectation,
                start: pathStart,
                end: pathStart + pathTrimmed.length,
                message: `"${typeReq.label}" には${typeReq.expectedLabel}が必要です（現在の型: ${resultType}）`,
                severity: typeReq.severity,
              });
            }
          }
        }
      }

      pos += binding.length + 1; // +1 for ';'
    }
  }

  return diagnostics;
}

// ============================================================
// Internal helpers
// ============================================================

interface BindAttrLocation {
  value: string;
  valueStart: number;
}

interface ParsedFilter {
  name: string;
  offset: number;
  args: string[];
  argsOffset: number;  // '(' の位置（引数全体のオフセット）
}

interface ParsedBinding {
  property: string;
  path: string | null;
  targetState: string;
  filters: ParsedFilter[];
  /** prop 側の input フィルタ（`value|number: path` — 書き戻し方向に適用） */
  inputFilters: ParsedFilter[];
}

/**
 * HTML から全てのバインド属性を検出する。
 */
function findAllBindAttributes(html: string, attrName: string): BindAttrLocation[] {
  const attrs: BindAttrLocation[] = [];
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}\\s*=\\s*(["'])`, 'gi');

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const quote = match[1];
    const valueStart = match.index + match[0].length;
    const valueEnd = html.indexOf(quote, valueStart);
    if (valueEnd === -1) continue;

    attrs.push({
      value: html.slice(valueStart, valueEnd),
      valueStart,
    });
  }

  return attrs;
}

/**
 * バインディング式を `;` で分割する。
 */
function splitBindingExpressions(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (const ch of value) {
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === ';' && parenDepth === 0) {
      result.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

/**
 * 単一のバインディング式を解析する。
 */
function parseBindingExpression(expr: string): ParsedBinding {
  const colonIndex = expr.indexOf(':');

  if (colonIndex === -1) {
    // else ディレクティブなど（パスなし）
    return { property: expr.trim(), path: null, targetState: 'default', filters: [], inputFilters: [] };
  }

  // prop 側の input フィルタを分離（`value|number: path` — parsePropPart.ts と対応）
  const rawProp = expr.slice(0, colonIndex);
  const propSegments = splitByPipe(rawProp);
  const property = propSegments[0].trim();
  const inputFilters = parseFilterSegments(expr, propSegments.slice(1), propSegments[0].length + 1);

  const afterColon = expr.slice(colonIndex + 1);

  // フィルタを分離（括弧内の `|` はスキップ）
  const segments = splitByPipe(afterColon);
  const pathSegment = segments[0] || '';
  const filterSegments = segments.slice(1);

  // @state 部分を分離
  const atIndex = pathSegment.indexOf('@');
  const path = atIndex !== -1 ? pathSegment.slice(0, atIndex) : pathSegment;
  const targetState = atIndex !== -1 ? pathSegment.slice(atIndex + 1).trim() || 'default' : 'default';

  // フィルタ名・引数・オフセットを抽出
  const filters = parseFilterSegments(expr, filterSegments, colonIndex + 1 + pathSegment.length + 1);

  return { property, path: path.trim() || null, targetState, filters, inputFilters };
}

/**
 * `|` 分割済みのフィルタセグメント列から名前・引数・オフセットを抽出する。
 *
 * @param expr - バインディング式全体（オフセット計算の基準）
 * @param segments - フィルタセグメント（先頭の prop/path セグメントを除いたもの）
 * @param searchStart - 最初のセグメントの expr 内開始位置
 */
function parseFilterSegments(expr: string, segments: string[], searchStart: number): ParsedFilter[] {
  const filters: ParsedFilter[] = [];
  let filterSearchStart = searchStart;

  for (const seg of segments) {
    const trimmed = seg.trim();
    const filterMatch = trimmed.match(/^(\w+)(?:\(([^)]*)\))?/);
    if (filterMatch) {
      const nameOffset = expr.indexOf(trimmed, filterSearchStart);
      const args = filterMatch[2] !== undefined
        ? filterMatch[2].split(',').map(a => a.trim()).filter(a => a !== '')
        : [];
      filters.push({
        name: filterMatch[1],
        offset: nameOffset >= 0 ? nameOffset : filterSearchStart,
        args,
        argsOffset: nameOffset >= 0 ? nameOffset + filterMatch[1].length : filterSearchStart,
      });
    }
    filterSearchStart += seg.length + 1; // +1 for '|'
  }

  return filters;
}

/**
 * フィルタ1件の名前・引数個数・引数型を検証する（input / output 共通）。
 */
function validateFilterUsage(filter: ParsedFilter, bindingStart: number): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];
  const info = filterMap.get(filter.name);
  if (!info) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterUnknown,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: `フィルタ "${filter.name}" は組み込みフィルタに存在しません`,
      severity: 'warning',
    });
    return diagnostics;
  }

  // 引数の個数チェック
  const argCount = filter.args.length;
  if (argCount < info.minArgs) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterArity,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: `フィルタ "${filter.name}" には最低 ${info.minArgs} 個の引数が必要です（${argCount} 個指定）`,
      severity: 'error',
    });
  } else if (argCount > info.maxArgs) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterArity,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: `フィルタ "${filter.name}" の引数は最大 ${info.maxArgs} 個です（${argCount} 個指定）`,
      severity: 'error',
    });
  }

  // 引数の型チェック
  if (info.argTypes && argCount > 0) {
    for (let i = 0; i < Math.min(argCount, info.argTypes.length); i++) {
      const expectedArgType = info.argTypes[i];
      if (expectedArgType === 'any') continue;
      const actualArgType = inferArgType(filter.args[i]);
      if (actualArgType !== expectedArgType) {
        diagnostics.push({
          code: WcsDiagnosticCode.FilterArgType,
          start: bindingStart + filter.argsOffset,
          end: bindingStart + filter.argsOffset + filter.name.length,
          message: `フィルタ "${filter.name}" の第${i + 1}引数は ${expectedArgType} 型が必要です（"${filter.args[i]}" は ${actualArgType} 型）`,
          severity: 'warning',
        });
      }
    }
  }

  return diagnostics;
}

/**
 * `|` で分割する（括弧内の `|` はスキップ）。
 */
function splitByPipe(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (const ch of value) {
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '|' && parenDepth === 0) {
      result.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

/**
 * パスの存在検証を行い、問題があれば診断メッセージを返す（なければ null）。
 *
 * `$` 名前空間はランタイム（proxy/traps/get.ts・event/handler.ts）の解決規則に合わせる:
 * - `$1`〜`$128`: ループインデックス。状態定義に依存しないためスキップ。
 * - `$command.<name>`: $commandTokens 宣言と照合（宣言が解析できている場合のみ）。
 * - `$streamStatus.<name>` / `$streamError.<name>`: $streams 宣言と照合（同上）。
 * - それ以外は状態パスセットとの完全一致。
 */
function validatePathExistence(
  checkPath: string,
  displayPath: string,
  scopedPaths: PathCandidate[],
  scopedPathSet: Set<string>,
  commandNames: Set<string>,
): string | null {
  if (/^\$\d+$/.test(checkPath)) return null;

  if (checkPath.startsWith('$command.')) {
    if (commandNames.size > 0 && !commandNames.has(checkPath)) {
      return `コマンドトークン "${displayPath}" は $commandTokens に宣言されていません`;
    }
    return null;
  }

  if (checkPath.startsWith('$streamStatus.') || checkPath.startsWith('$streamError.')) {
    const prefix = checkPath.startsWith('$streamStatus.') ? '$streamStatus.' : '$streamError.';
    // $streams 宣言が解析できていない（候補ゼロ）場合は誤警告を避けてスキップ
    const hasNamespace = scopedPaths.some(p => p.path.startsWith(prefix));
    if (hasNamespace && !scopedPathSet.has(checkPath)) {
      return `パス "${displayPath}" は $streams 宣言に存在しません`;
    }
    return null;
  }

  if (!scopedPathSet.has(checkPath)) {
    return `パス "${displayPath}" は状態定義に存在しません`;
  }
  return null;
}

interface TypeRequirement {
  label: string;
  expected: string;
  expectedLabel: string;
  severity: 'error' | 'warning';
}

/**
 * プロパティ名から期待される型を返す。型制約がない場合は null。
 */
function getExpectedType(property: string): TypeRequirement | null {
  const prop = property.replace(/#.*$/, ''); // 修飾子を除去

  if (prop === 'for') {
    return { label: 'for', expected: 'array', expectedLabel: '配列型のパス', severity: 'error' };
  }
  if (prop === 'if' || prop === 'elseif') {
    return { label: prop, expected: 'boolean', expectedLabel: 'ブーリアン型', severity: 'warning' };
  }
  if (prop.startsWith('class.')) {
    return { label: prop, expected: 'boolean', expectedLabel: 'ブーリアン型', severity: 'warning' };
  }
  if (prop.startsWith('attr.')) {
    return { label: prop, expected: 'string', expectedLabel: '文字列型', severity: 'warning' };
  }
  if (prop.startsWith('style.')) {
    return { label: prop, expected: 'string', expectedLabel: '文字列型', severity: 'warning' };
  }
  return null;
}

/**
 * フィルタチェーン内の各フィルタの入力型と前のフィルタの出力型の整合性を検証する。
 */
function validateFilterChainTypes(
  path: string,
  filters: { name: string; offset: number }[],
  statePaths: PathCandidate[],
  bindingStart: number,
): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];

  // 初期型を取得
  const pathInfo = statePaths.find(p => p.path === path);
  if (!pathInfo?.typeHint) return diagnostics;

  let currentType = pathInfo.typeHint;

  for (const filter of filters) {
    const info = filterMap.get(filter.name);
    if (!info) break; // 不明なフィルタ → チェーン中断

    // 入力型チェック
    if (info.acceptTypes !== 'any') {
      // union 型の場合、いずれかの部分型がマッチすれば OK
      const currentTypes = currentType.split('|');
      const hasMatch = currentTypes.some(t => (info.acceptTypes as string[]).includes(t));
      if (!hasMatch) {
        diagnostics.push({
          code: WcsDiagnosticCode.FilterInputType,
          start: bindingStart + filter.offset,
          end: bindingStart + filter.offset + filter.name.length,
          message: `フィルタ "${filter.name}" は ${(info.acceptTypes as string[]).join('|')} 型の入力が必要です（現在の型: ${currentType}）`,
          severity: 'warning',
        });
      }
    }

    // 出力型を更新
    if (info.resultType !== 'passthrough') {
      currentType = info.resultType;
    }
  }

  return diagnostics;
}

/**
 * パスの型をフィルタチェーンを通して解決する。
 * 型が不明な場合は null を返す（検証をスキップ）。
 */
function resolveResultType(
  path: string,
  filters: { name: string; offset: number }[],
  statePaths: PathCandidate[],
): string | null {
  // パスの初期型を取得
  const pathInfo = statePaths.find(p => p.path === path);
  if (!pathInfo?.typeHint) return null;

  let currentType = pathInfo.typeHint;

  // フィルタチェーンを通して型を更新
  for (const filter of filters) {
    const info = filterMap.get(filter.name);
    if (!info) return null; // 不明なフィルタ → 型追跡を中止
    if (info.resultType === 'passthrough') continue;
    currentType = info.resultType;
  }

  return currentType;
}

/**
 * フィルタ引数の型を推定する。
 * state 側ではすべての引数が文字列として扱われるため、
 * 引用符なしでも数値以外はすべて string とみなす。
 */
function inferArgType(arg: string): string {
  const v = arg.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number';
  return 'string';
}

/**
 * リテラル値かどうかを判定（数値、文字列リテラル等）。
 */
function isLiteral(value: string): boolean {
  return /^-?\d/.test(value) || /^["'`]/.test(value) || value === 'true' || value === 'false' || value === 'null';
}
