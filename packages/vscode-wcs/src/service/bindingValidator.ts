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
import { STRUCTURAL_BINDING_TYPE_SET } from './wcsManifest.js';
import { mergeSchemaCandidates, type PathCandidate } from './stateAnalyzer.js';
import { getStatePathsFromHtml, type FileReader } from './statePathResolver.js';
import { isInsideForTemplate, getInnermostForPath, getAvailableWildcardRank, countWildcardSegments } from './forContext.js';
import { WcsDiagnosticCode, type WcsDiagnosticCodeValue } from '../core/diagnostics.js';
import { getMessages, type WcsMessageCatalog, type ExpectedTypeKind } from '../core/messages.js';
import { resolveSchemaPath } from '../core/sidecar/schemaSubset.js';
import type { JsonSchemaNode } from '../core/sidecar/types.js';

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
 * @param applicationStates - state 名 → stateSchema（sidecar manifest）。宣言された state では
 *   未存在パスが `wcs/path-nonexistent`（error）になり、`for:` の型不一致は
 *   `wcs/path-type-mismatch`（error）になる。同じパスの typeHint は schema が勝つ（D12）。
 */
export function validateBindings(
  html: string,
  attrName: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
  applicationStates?: ReadonlyMap<string, JsonSchemaNode>,
): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];
  const msgs = getMessages(locale);

  // 状態パスを収集（state 名ごとに分類）。schema 由来の候補は補完・型期待用に合流させる
  // （同一パスは schema 優先）。存在判定は候補集合ではなく resolveSchemaPath で行う（下記）。
  const statePaths = mergeSchemaCandidates(getStatePathsFromHtml(html, stateTagName, fileReader), applicationStates);

  // バインド属性を全て検出
  const attrs = findAllBindAttributes(html, attrName);

  // if/elseif の型要求判定にだけ要る構造テンプレート一覧は遅延収集する。
  let structuralTemplates: StructuralTemplate[] | null = null;
  const getStructuralTemplates = (): StructuralTemplate[] => {
    structuralTemplates ??= collectStructuralTemplates(html, attrName);
    return structuralTemplates;
  };

  const filterNameSet = new Set(BUILTIN_FILTERS.map(f => f.name));

  for (const attr of attrs) {
    const bindings = splitBindingExpressions(attr.value);

    // 構造ディレクティブ（for/if/elseif/else）の単独バインディング検査。ランタイム
    // （parseBindTextsForElement.ts）は違反を raiseError で落とす ＝ ページ初期化ごと
    // 止まるため error。判定はランタイムと同値に保つ: 空要素の数え方（trim 後に
    // 非空のみ）に加え、構造判定は **修飾子分離より前の完全一致**（`for#x` は
    // ランタイムでは構造でなく通常 prop になるため、`#` を剥がしてはならない）。
    const nonEmptyCount = bindings.filter(b => b.trim().length > 0).length;
    if (nonEmptyCount > 1) {
      let scanPos = 0;
      for (const b of bindings) {
        const colon = b.indexOf(':');
        const prop = (colon === -1 ? b : b.slice(0, colon)).trim();
        if ((STRUCTURAL_BINDING_TYPE_SET as ReadonlySet<string>).has(prop)) {
          const leading = b.length - b.trimStart().length;
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: attr.valueStart + scanPos + leading,
            end: attr.valueStart + scanPos + b.trimEnd().length,
            message: msgs.structuralMustBeSingle(prop),
            severity: 'error',
          });
        }
        scanPos += b.length + 1;
      }
    }

    let pos = 0;

    for (const binding of bindings) {
      const bindingStart = attr.valueStart + pos;

      // パスとフィルタを抽出
      const parsed = parseBindingExpression(binding);

      // パス検証（v2: 1 root 1 ツリー — スコープは無い）
      const scopedPaths = statePaths;
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
            message: msgs.spreadFilterNotAllowed(),
            severity: 'error',
          });
        }
        if (!parsed.path || parsed.path.trim() === '') {
          diagnostics.push({
            code: WcsDiagnosticCode.TemplateSyntax,
            start: bindingStart,
            end: bindingStart + binding.length,
            message: msgs.spreadTargetRequired(),
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
            message: msgs.eventTokenUndeclared(tokenName),
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
              message: msgs.commandRhsFormat(),
              severity: 'warning',
            });
          } else if (commandNames.size > 0 && !commandNames.has(tokenPath)) {
            diagnostics.push({
              code: WcsDiagnosticCode.TokenUndeclared,
              start: pathStart,
              end: pathStart + tokenPath.length,
              message: msgs.commandTokenUndeclared(tokenPath),
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
              // 単独の `.` は行そのもの＝`<forPath>.*`（末尾に区切りは付かない）。
              // ランタイム: state/src/structural/expandShorthandPaths.ts
              checkPath = pathTrimmed === '.'
                ? `${forPath}.*`
                : `${forPath}.*.${pathTrimmed.slice(1)}`;
            } else {
              checkPath = ''; // 展開できない場合はスキップ
            }
          }
          if (checkPath) {
            const schema = applicationStates?.get('default');
            const verdict = schema !== undefined
              ? validateSchemaPathExistence(checkPath, pathTrimmed, scopedPaths, scopedPathSet, commandNames, schema, msgs)
              : toMissingVerdict(validatePathExistence(checkPath, pathTrimmed, scopedPaths, scopedPathSet, commandNames, msgs));
            if (verdict) {
              const pathOffset = binding.indexOf(parsed.path);
              const pathStart = bindingStart + pathOffset;
              diagnostics.push({
                code: verdict.code,
                start: pathStart,
                end: pathStart + pathTrimmed.length,
                message: `${verdict.message}${pathTrimmed.startsWith('.') ? msgs.expansionSuffix(checkPath) : ''}`,
                severity: verdict.severity,
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
              message: msgs.patternPathOutsideFor(pathTrimmed),
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
              message: msgs.omittedPathOutsideFor(pathTrimmed),
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
              message: msgs.loopIndexOutsideFor(pathTrimmed),
              severity: 'warning',
            });
          }

          // for の**段数**を超える階数を使用（`matrix.*.*` を 1 段の for で読む、
          // `$2` を 1 段のループで読む）。上の 3 つは「for の外か否か」の二値しか
          // 見ておらず、深さ方向は誰も検査していなかった。available === 0 は上の
          // patternPathOutsideFor / loopIndexOutsideFor が担うので、ここは
          // 「for の中に居るが段数が足りない」だけを見る（二重報告を避ける）。
          // `@state` 越境は for のスコープと別 state なので判定しない（binding 生テキストで見る
          // ── parsed.path は `@state` を落としたあとの値なので、そこでは判別できない）
          if (insideFor && !pathTrimmed.startsWith('.') && !binding.includes('@')) {
            const indexMatch = /^\$(\d+)$/.exec(pathTrimmed);
            const needed = indexMatch !== null
              ? Number(indexMatch[1])
              : (pathTrimmed.includes('*') ? countWildcardSegments(pathTrimmed) : 0);
            if (needed > 0) {
              const available = getAvailableWildcardRank(html, attr.valueStart, attrName);
              if (available > 0 && needed > available) {
                const pathOffset = binding.indexOf(parsed.path);
                const pathStart = bindingStart + pathOffset;
                diagnostics.push({
                  code: WcsDiagnosticCode.WildcardRank,
                  start: pathStart,
                  end: pathStart + pathTrimmed.length,
                  message: msgs.wildcardRank(`"${pathTrimmed}"`, needed, available),
                  severity: 'warning',
                });
              }
            }
          }

          // UI で解決済みパス（数値セグメントを含む）を使用
          if (/\.\d+\.|\.\d+$/.test(pathTrimmed)) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              code: WcsDiagnosticCode.TemplateSyntax,
              start: pathStart,
              end: pathStart + pathTrimmed.length,
              message: msgs.resolvedPathInUi(pathTrimmed),
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
            message: msgs.handlerFilterNotAllowed(parsed.property),
            severity: 'warning',
          });
        }
      } else {
        for (const filter of parsed.filters) {
          diagnostics.push(...validateFilterUsage(filter, bindingStart, msgs));
        }

        // フィルタ間の入力型チェック
        if (parsed.path && statePaths.length > 0) {
          const pathTrimmed = parsed.path.trim();
          if (pathTrimmed && !pathTrimmed.startsWith('.') && !isLiteral(pathTrimmed)) {
            const chainDiags = validateFilterChainTypes(
              pathTrimmed, parsed.filters, scopedPaths, bindingStart, msgs,
            );
            diagnostics.push(...chainDiags);
          }
        }
      }

      // prop 側 input フィルタの検証（two-way の書き戻し方向。
      // ランタイムの input / output フィルタ集合は同一 — filters/builtinFilters.ts）
      for (const filter of parsed.inputFilters) {
        diagnostics.push(...validateFilterUsage(filter, bindingStart, msgs));
      }

      // プロパティに応じた型チェック
      if (parsed.path && scopedPaths.length > 0) {
        const pathTrimmed = parsed.path.trim();
        if (pathTrimmed && !pathTrimmed.startsWith('.') && !isLiteral(pathTrimmed)) {
          const resultType = resolveResultType(pathTrimmed, parsed.filters, scopedPaths);
          if (resultType !== null) {
            const typeReq = getExpectedType(
              parsed.property,
              () => isNegatedByElseChain(getStructuralTemplates(), attr.valueStart),
            );
            if (typeReq && resultType !== typeReq.expected) {
              const pathOffset = binding.indexOf(parsed.path);
              const pathStart = bindingStart + pathOffset;
              // `for:` に対して stateSchema が非配列と**確定**している（schema 由来の候補・
              // フィルタ無し）場合だけ、規範 §6「definite type mismatch → error」の code で
              // 報告する。schema 無し / フィルタ経由の型は従来の期待違反のまま。
              const schemaDefinite = typeReq.expected === 'array'
                && parsed.filters.length === 0
                && applicationStates?.has('default') === true
                && scopedPaths.some(p => p.path === pathTrimmed && p.fromSchema === true);
              diagnostics.push({
                code: schemaDefinite ? WcsDiagnosticCode.PathTypeMismatch : WcsDiagnosticCode.BindingTypeExpectation,
                start: pathStart,
                end: pathStart + pathTrimmed.length,
                message: schemaDefinite
                  ? msgs.pathTypeMismatch(pathTrimmed, typeReq.label, typeReq.expected, resultType)
                  : msgs.typeExpectation(typeReq.label, typeReq.expected, resultType),
                severity: schemaDefinite ? 'error' : typeReq.severity,
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

export interface BindAttrLocation {
  value: string;
  valueStart: number;
}

interface ParsedFilter {
  name: string;
  offset: number;
  args: string[];
  argsOffset: number;  // '(' の位置（引数全体のオフセット）
}

export interface ParsedBinding {
  property: string;
  path: string | null;

  filters: ParsedFilter[];
  /** prop 側の input フィルタ（`value|number: path` — 書き戻し方向に適用） */
  inputFilters: ParsedFilter[];
}

/**
 * HTML から全てのバインド属性を検出する。
 */
/**
 * HTML 中の全バインド属性を値の開始オフセット付きで検出する。
 * （core/index/referenceIndex が同一走査を共有するため export — 走査が
 * 二重実装になると診断とインデックスで属性の解釈が割れる。）
 */
export function findAllBindAttributes(html: string, attrName: string): BindAttrLocation[] {
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
 * （ioNodeValidator が同一パーサを共有するため export — 二重実装で構文解釈が
 * 割れると IDE / CI の診断が食い違うので、必ずこちらを使うこと。）
 */
export function splitBindingExpressions(value: string): string[] {
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
 * （ioNodeValidator が同一パーサを共有するため export。）
 */
export function parseBindingExpression(expr: string): ParsedBinding {
  const colonIndex = expr.indexOf(':');

  if (colonIndex === -1) {
    // else ディレクティブなど（パスなし）
    return { property: expr.trim(), path: null, filters: [], inputFilters: [] };
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

  // '@' から後ろは v2 の parse error（namedStateValidator が error で報告する）—
  // 寛容パースはパス部分だけを対象にする
  const atIndex = pathSegment.indexOf('@');
  const path = atIndex !== -1 ? pathSegment.slice(0, atIndex) : pathSegment;

  // フィルタ名・引数・オフセットを抽出
  const filters = parseFilterSegments(expr, filterSegments, colonIndex + 1 + pathSegment.length + 1);

  return { property, path: path.trim() || null, filters, inputFilters };
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
function validateFilterUsage(filter: ParsedFilter, bindingStart: number, msgs: WcsMessageCatalog): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];
  const info = filterMap.get(filter.name);
  if (!info) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterUnknown,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: msgs.filterUnknown(filter.name),
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
      message: msgs.filterMinArgs(filter.name, info.minArgs, argCount),
      severity: 'error',
    });
  } else if (argCount > info.maxArgs) {
    diagnostics.push({
      code: WcsDiagnosticCode.FilterArity,
      start: bindingStart + filter.offset,
      end: bindingStart + filter.offset + filter.name.length,
      message: msgs.filterMaxArgs(filter.name, info.maxArgs, argCount),
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
          message: msgs.filterArgType(filter.name, i + 1, expectedArgType, filter.args[i], actualArgType),
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
  msgs: WcsMessageCatalog,
): string | null {
  if (/^\$\d+$/.test(checkPath)) return null;

  if (checkPath.startsWith('$command.')) {
    if (commandNames.size > 0 && !commandNames.has(checkPath)) {
      return msgs.commandTokenUndeclared(displayPath);
    }
    return null;
  }

  if (checkPath.startsWith('$streamStatus.') || checkPath.startsWith('$streamError.')) {
    const prefix = checkPath.startsWith('$streamStatus.') ? '$streamStatus.' : '$streamError.';
    // $streams 宣言が解析できていない（候補ゼロ）場合は誤警告を避けてスキップ
    const hasNamespace = scopedPaths.some(p => p.path.startsWith(prefix));
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

/** 存在判定の結果（code / severity 込み）。null = 問題なし。 */
interface PathVerdict {
  code: WcsDiagnosticCodeValue;
  message: string;
  severity: 'error' | 'warning';
}

function toMissingVerdict(message: string | null): PathVerdict | null {
  return message ? { code: WcsDiagnosticCode.BindingPathMissing, message, severity: 'warning' } : null;
}

/**
 * stateSchema が宣言された state の存在判定（docs/app-testing-and-typescript-impl-plan.md D6）。
 *
 * - `$` 名前空間（ループ添字 / command / stream）は schema に載らないので従来規則のまま。
 * - script / JSON / schema 由来の候補集合に当たれば存在（メソッド・getter・`$listKeys` 派生など
 *   schema に載らない宣言を先に拾う）。
 * - 残りは `resolveSchemaPath` の三値: `nonexistent`（object と確定しているのに member が無い）
 *   だけを `wcs/path-nonexistent`（error）にし、`unknown`（素の `{}` の下・型未確定）と
 *   `ref-error`（manifest 側の診断が担う）は沈黙する。候補集合だけで判定すると unknown が
 *   「候補に無い = 不在」に化けて偽 error になる。
 */
function validateSchemaPathExistence(
  checkPath: string,
  displayPath: string,
  scopedPaths: PathCandidate[],
  scopedPathSet: Set<string>,
  commandNames: Set<string>,
  schema: JsonSchemaNode,
  msgs: WcsMessageCatalog,
): PathVerdict | null {
  if (checkPath.startsWith('$')) {
    return toMissingVerdict(validatePathExistence(checkPath, displayPath, scopedPaths, scopedPathSet, commandNames, msgs));
  }
  if (scopedPathSet.has(checkPath)) return null;
  const resolution = resolveSchemaPath(schema, schema.$defs ?? {}, checkPath.split('.'));
  if (resolution.kind === 'nonexistent') {
    return { code: WcsDiagnosticCode.PathNonexistent, message: msgs.pathNonexistent(displayPath), severity: 'error' };
  }
  return null;
}

/** 構造ディレクティブを持つ `<template>` 1 つ分（if チェーン判定用）。 */
interface StructuralTemplate {
  /** バインド属性値の開始オフセット（findAllBindAttributes の valueStart と一致）。 */
  valueStart: number;
  /** `<template>` のネスト深さ（0 = 最上位）。ランタイムはネストごとに別チェーンを組む。 */
  depth: number;
  /** 先頭バインディングのプロパティ名（構造ディレクティブ以外は 'other'）。 */
  type: 'if' | 'elseif' | 'else' | 'other';
}

/**
 * HTML 内のバインド属性付き `<template>` を出現順に収集する。
 * ランタイム（structural/collectStructuralFragments.ts）は同じ順序でチェーンを組む。
 */
function collectStructuralTemplates(html: string, attrName: string): StructuralTemplate[] {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attrRegex = new RegExp(`${escaped}\\s*=\\s*(["'])`, 'i');
  const tagRegex = /<template(?:\s[^>]*)?>|<\/template\s*>/gi;
  const templates: StructuralTemplate[] = [];
  let depth = 0;

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    if (match[0].startsWith('</')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const attrMatch = attrRegex.exec(match[0]);
    if (attrMatch) {
      const quote = attrMatch[1];
      const valueStart = match.index + attrMatch.index + attrMatch[0].length;
      const valueEnd = html.indexOf(quote, valueStart);
      if (valueEnd !== -1) {
        // 構造ディレクティブは単独バインディング必須（parseBindTextsForElement.ts）。
        const first = splitBindingExpressions(html.slice(valueStart, valueEnd))[0] ?? '';
        const prop = first.split(':')[0].replace(/#.*$/, '').trim();
        const type = prop === 'if' || prop === 'elseif' || prop === 'else' ? prop : 'other';
        templates.push({ valueStart, depth, type });
      }
    }
    depth++;
  }

  return templates;
}

/**
 * `if:` / `elseif:` の条件値が else チェーンによって `not` 否定されるかを判定する。
 *
 * ランタイムは `elseif` / `else` を直前の `if` / `elseif` にぶら下げ、その条件へ `not` を
 * 付けた否定フラグメントを作る（collectStructuralFragments.ts）。`not` は boolean 以外で
 * raise するため、後続に `elseif` / `else` がある条件だけが boolean 必須になる。
 * ネストした `<template>` は別スコープで再帰処理されるのでチェーンに加わらない。
 */
function isNegatedByElseChain(templates: StructuralTemplate[], valueStart: number): boolean {
  const index = templates.findIndex(t => t.valueStart === valueStart);
  if (index === -1) return false;

  const selfDepth = templates[index].depth;
  for (let i = index + 1; i < templates.length; i++) {
    const next = templates[i];
    if (next.depth > selfDepth) continue;   // 子孫＝別スコープ
    if (next.depth < selfDepth) return false; // 親を抜けた＝チェーン終了
    if (next.type === 'elseif' || next.type === 'else') return true;
    if (next.type === 'if') return false;   // 新しいチェーンの開始
    // 'other'（for など）はチェーンを切らない — ランタイムも直前の if を保持する。
  }
  return false;
}

interface TypeRequirement {
  label: string;
  expected: ExpectedTypeKind;
  severity: 'error' | 'warning';
}

/**
 * プロパティ名から期待される型を返す。型制約がない場合は null。
 *
 * @param isNegatedIf - `if` / `elseif` の値が else チェーンで `not` 否定されるか
 *   （遅延評価。if / elseif 以外では呼ばれない）
 */
function getExpectedType(property: string, isNegatedIf: () => boolean): TypeRequirement | null {
  const prop = property.replace(/#.*$/, ''); // 修飾子を除去

  if (prop === 'for') {
    return { label: 'for', expected: 'array', severity: 'error' };
  }
  if (prop === 'if' || prop === 'elseif') {
    // 単独の if / elseif はランタイムが Boolean() で強制変換する（apply/applyChangeToIf.ts）
    // ので任意の型を受け付ける。後続に elseif / else が続く場合だけ、その条件へ `not`
    // フィルタが後付けされ（structural/collectStructuralFragments.ts）、boolean 以外は
    // 実行時に raise する。型を要求できるのはその場合だけ。
    if (!isNegatedIf()) return null;
    return { label: prop, expected: 'boolean', severity: 'warning' };
  }
  if (prop.startsWith('class.')) {
    return { label: prop, expected: 'boolean', severity: 'warning' };
  }
  if (prop.startsWith('attr.')) {
    return { label: prop, expected: 'string', severity: 'warning' };
  }
  if (prop.startsWith('style.')) {
    return { label: prop, expected: 'string', severity: 'warning' };
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
  msgs: WcsMessageCatalog,
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
          message: msgs.filterInputType(filter.name, (info.acceptTypes as string[]).join('|'), currentType),
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
